// Regression coverage for the Phase 1 behavior that must still hold with
// a single, default hourglass card: this is what a bare `index.html` visit
// (or an old shared ?minutes=&autostart= link) looks like.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
});

test('loads with exactly one default 5-minute amber card', async ({ page }) => {
    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.time-readout')).toHaveText('05:00');
    const removeDisabled = await cards.first().locator('[data-action="remove"]').isDisabled();
    expect(removeDisabled).toBe(true); // can't remove the only card
});

test('start/pause toggles the icon and the readout counts down', async ({ page }) => {
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    const toggle = card.locator('[data-action="toggle"]');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Pause');
    await page.waitForTimeout(1500);
    await expect(card.locator('.time-readout')).not.toHaveText('05:00');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Start');
});

test('reset returns to the full duration', async ({ page }) => {
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await card.locator('[data-action="toggle"]').click();
    await page.waitForTimeout(1200);
    await card.locator('[data-action="reset"]').click();
    await expect(card.locator('.time-readout')).toHaveText('05:00');
    await expect(card.locator('[data-action="toggle"]')).toHaveAttribute('aria-label', 'Start');
});

test('clicking the hourglass flips it and commits to running', async ({ page }) => {
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await card.locator('.hourglass-shell').click();
    // flip() pauses immediately then only resumes ~0.3-0.5s later — the
    // toggle icon must optimistically show "Pause" right away regardless
    // (see js/cards.js flipPending), not lag behind the animation.
    await expect(card.locator('[data-action="toggle"]')).toHaveAttribute('aria-label', 'Pause');
});

test('mute button toggles and persists across reload', async ({ page }) => {
    const muteBtn = page.locator('#muteBtn');
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'true');
});

test('?minutes= and &autostart=1 still bootstrap a running custom card', async ({ page }) => {
    await page.goto('/index.html?minutes=17&autostart=1');
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await expect(card.locator('.time-readout')).toHaveText('17:00');
    await expect(card.locator('[data-action="toggle"]')).toHaveAttribute('aria-label', 'Pause');
});
