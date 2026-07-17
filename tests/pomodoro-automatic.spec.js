// Pomodoro preset + Phase 3 automatic mode sequencer.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
});

test('Pomodoro button sets up Focus (25, red) + Break (5, green) in automatic mode', async ({ page }) => {
    await page.locator('#pomodoroBtn').click();

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.card-label')).toHaveText(['Focus', 'Break']);
    await expect(cards.nth(0).locator('.time-readout')).toHaveText('25:00');
    await expect(cards.nth(1).locator('.time-readout')).toHaveText('05:00');
    await expect(page.locator('#autoModeToggle')).toBeChecked();
});

test('automatic mode: play on a card starts the sequence, pause/resume/reset behave', async ({ page }) => {
    await page.locator('#pomodoroBtn').click();
    const focus = page.locator('.hourglass-card', { hasText: 'Focus' });
    const brk = page.locator('.hourglass-card', { hasText: 'Break' });

    await focus.locator('[data-action="toggle"]').click();
    await expect(focus).toHaveClass(/is-sequence-active/);

    // edit/remove are locked on every card while a sequence is running
    await expect(focus.locator('[data-action="edit"]')).toBeDisabled();
    await expect(brk.locator('[data-action="remove"]')).toBeDisabled();
    // flipping (manual pour) is meaningless in automatic mode
    await expect(focus.locator('.hourglass-shell')).toHaveClass(/is-flip-disabled/);

    // pause = stop in place (toggling the active card again)
    await focus.locator('[data-action="toggle"]').click();
    await expect(focus).not.toHaveClass(/is-sequence-active/);

    // clicking the same card again resumes rather than restarting fresh
    await focus.locator('[data-action="toggle"]').click();
    await expect(focus).toHaveClass(/is-sequence-active/);

    // reset is a hard stop: clears the active card and the elapsed time
    await focus.locator('[data-action="reset"]').click();
    await expect(focus).not.toHaveClass(/is-sequence-active/);
    await expect(focus.locator('.time-readout')).toHaveText('25:00');
    await expect(focus.locator('[data-action="edit"]')).toBeEnabled();
});

test('turning automatic mode off stops any running sequence', async ({ page }) => {
    await page.locator('#pomodoroBtn').click();
    const focus = page.locator('.hourglass-card', { hasText: 'Focus' });
    await focus.locator('[data-action="toggle"]').click();
    await expect(focus).toHaveClass(/is-sequence-active/);

    await page.getByText('Automatic mode').click();
    await expect(page.locator('#autoModeToggle')).not.toBeChecked();
    await expect(focus).not.toHaveClass(/is-sequence-active/);
});

test('the Automatic mode toggle is hidden with one card and reappears with two', async ({ page }) => {
    const autoModeRow = page.locator('#autoModeRow');
    await expect(autoModeRow).toBeHidden();

    await page.locator('.hourglass-card--add').click();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();
    await expect(autoModeRow).toBeVisible();

    // dropping back to one card turns it off too — no orphaned "on" state once its toggle is hidden
    await page.getByText('Automatic mode').click();
    await expect(page.locator('#autoModeToggle')).toBeChecked();
    await page.locator('.hourglass-card:not(.hourglass-card--add)').nth(1)
        .locator('[data-action="remove"]').click();
    await expect(autoModeRow).toBeHidden();
    await expect(page.locator('#autoModeToggle')).not.toBeChecked();
});

test('a real 1-minute card genuinely auto-advances to the next one when it finishes', async ({ page }) => {
    test.setTimeout(120_000);

    // Two real (non-mocked) 1-minute cards — proves card finishes -> next resets and starts -> loops.
    const first = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await first.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .duration-input').fill('1');
    await page.locator('.hourglass-card.is-configuring .duration-input').blur();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    await page.locator('.hourglass-card--add').click();
    await page.locator('.hourglass-card.is-configuring .duration-input').fill('1');
    await page.locator('.hourglass-card.is-configuring .duration-input').blur();
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    await page.getByText('Automatic mode').click();

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    const second = cards.nth(1);
    await first.locator('[data-action="toggle"]').click();
    await expect(first).toHaveClass(/is-sequence-active/);

    // the 1-minute countdown + the sequencer's own post-done advance delay
    await expect(second).toHaveClass(/is-sequence-active/, { timeout: 75_000 });
    await expect(first).not.toHaveClass(/is-sequence-active/);
    await expect(first.locator('.time-readout')).toHaveText('00:00');
});
