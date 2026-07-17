// Phase 2: adding/configuring/removing hourglass cards side by side.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
});

test('add button opens a new card in configuring state, capped at 3 cards', async ({ page }) => {
    const addBtn = page.locator('.hourglass-card--add');

    await addBtn.click();
    await expect(page.locator('.hourglass-card.is-configuring')).toHaveCount(1);
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(2);

    await addBtn.click();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(3);

    // a 4th is refused — Add disappears entirely, reappears once a card is removed
    await expect(addBtn).toBeHidden();
    await page.locator('.hourglass-card:not(.hourglass-card--add)').first()
        .locator('[data-action="remove"]').click();
    await expect(addBtn).toBeVisible();
});

test('cancelling a brand-new card discards it entirely', async ({ page }) => {
    await page.locator('.hourglass-card--add').click();
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(2);
    await page.locator('.hourglass-card.is-configuring [data-action="cancel"]').click();
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(1);
});

test('editing an existing card and cancelling reverts the change', async ({ page }) => {
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await expect(card.locator('.time-readout')).toHaveText('05:00');

    await card.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .preset-btn[data-minutes="25"]').click();
    await expect(page.locator('.hourglass-card.is-configuring .time-readout')).toHaveText('25:00');
    await page.locator('.hourglass-card.is-configuring [data-action="cancel"]').click();

    await expect(card.locator('.time-readout')).toHaveText('05:00');
});

test('editing and saving commits the change', async ({ page }) => {
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await card.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .preset-btn[data-minutes="30"]').click();
    await page.locator('.hourglass-card.is-configuring .card-label-input').fill('Deep work');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    await expect(card.locator('.time-readout')).toHaveText('30:00');
    await expect(card.locator('.card-label')).toHaveText('Deep work');
});

test('each card gets its own scoped sand color (no cross-card leakage)', async ({ page }) => {
    await page.locator('.hourglass-card--add').click();
    const configuring = page.locator('.hourglass-card.is-configuring');
    await configuring.locator('.swatch-btn[data-color-id="teal"]').click();
    await configuring.locator('[data-action="save"]').click();

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    const firstColor = await cards.nth(0).evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    const secondColor = await cards.nth(1).evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    expect(firstColor).not.toBe(secondColor);

    // Regression check: every card must have its own uniquely-suffixed gradient ids, not borrow another's colors.
    const gradientIds = await page.locator('.hourglass-card linearGradient[id]').evaluateAll(
        (els) => els.map((el) => el.id)
    );
    expect(new Set(gradientIds).size).toBe(gradientIds.length);
});

test('a new card preselects the first sound not already in use', async ({ page }) => {
    const addBtn = page.locator('.hourglass-card--add');

    // default card starts on sound 1 ("done") -> next card should preselect 2
    await addBtn.click();
    await expect(page.locator('.hourglass-card.is-configuring .sound-btn.is-active'))
        .toHaveAttribute('data-sound-id', 'done2');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    // 1 and 2 now in use -> third card should preselect 3
    await addBtn.click();
    await expect(page.locator('.hourglass-card.is-configuring .sound-btn.is-active'))
        .toHaveAttribute('data-sound-id', 'done3');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();
});

test('preselection fills the gap when an earlier sound number is free', async ({ page }) => {
    const first = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await first.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .sound-btn[data-sound-id="done2"]').click();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    // only "done2" is in use -> a new card should preselect "done" (1), not "done3"
    await page.locator('.hourglass-card--add').click();
    await expect(page.locator('.hourglass-card.is-configuring .sound-btn.is-active'))
        .toHaveAttribute('data-sound-id', 'done');
});

test('removing a card works, but not down to zero', async ({ page }) => {
    await page.locator('.hourglass-card--add').click();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(2);

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await cards.nth(1).locator('[data-action="remove"]').click();
    await expect(cards).toHaveCount(1);

    const removeDisabled = await cards.first().locator('[data-action="remove"]').isDisabled();
    expect(removeDisabled).toBe(true);
});

test('sizing scales with duration: a 25-minute card renders larger than a 5-minute one', async ({ page }) => {
    await page.locator('.hourglass-card--add').click();
    const configuring = page.locator('.hourglass-card.is-configuring');
    await configuring.locator('.preset-btn[data-minutes="25"]').click();
    await configuring.locator('[data-action="save"]').click();

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    const fiveMinWidth = await cards.nth(0).locator('.hourglass-shell').evaluate((el) => el.getBoundingClientRect().width);
    const twentyFiveMinWidth = await cards.nth(1).locator('.hourglass-shell').evaluate((el) => el.getBoundingClientRect().width);
    expect(twentyFiveMinWidth).toBeGreaterThan(fiveMinWidth);
    // damped scaling — bigger, but nowhere near proportional to the 5x duration ratio
    expect(twentyFiveMinWidth / fiveMinWidth).toBeLessThan(2);
});
