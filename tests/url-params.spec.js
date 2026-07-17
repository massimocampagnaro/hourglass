// The URL mirrors the row's state (js/app.js syncUrl), so a copied link restores it.
const { test, expect } = require('@playwright/test');

test('default load produces a minimal, backward-compatible URL', async ({ page }) => {
    await page.goto('/index.html');
    const url = new URL(page.url());
    expect(url.searchParams.get('minutes')).toBe('5');
    // untouched defaults (amber, sound 1, no label) stay omitted
    expect(url.searchParams.has('color')).toBe(false);
    expect(url.searchParams.has('sound')).toBe(false);
    expect(url.searchParams.has('label')).toBe(false);
});

test('customizing the single card updates the URL, and reloading it restores the config', async ({ page }) => {
    await page.goto('/index.html');
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await card.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .swatch-btn[data-color-id="azure"]').click();
    await page.locator('.hourglass-card.is-configuring .sound-btn[data-sound-id="done2"]').click();
    await page.locator('.hourglass-card.is-configuring .card-label-input').fill('Deep Work');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    const url = new URL(page.url());
    expect(url.searchParams.get('color')).toBe('azure');
    expect(url.searchParams.get('sound')).toBe('done2');
    expect(url.searchParams.get('label')).toBe('Deep Work');

    await page.goto(page.url());
    await expect(page.locator('.card-label')).toHaveText('Deep Work');
    const restoredColor = await page.locator('.hourglass-card:not(.hourglass-card--add)').first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    expect(restoredColor).toContain('205'); // azure's hue
});

test('legacy ?minutes=&autostart= links still work unchanged', async ({ page }) => {
    await page.goto('/index.html?minutes=17&autostart=1');
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await expect(card.locator('.time-readout')).toHaveText('17:00');
    await expect(card.locator('[data-action="toggle"]')).toHaveAttribute('aria-label', 'Pause');
});

test('the Pomodoro preset URL round-trips through a fresh page load', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('#pomodoroBtn').click();
    const pomodoroUrl = page.url();

    await page.goto(pomodoroUrl);
    await expect(page.locator('.card-label')).toHaveText(['Focus', 'Break']);
    await expect(page.locator('#autoModeToggle')).toBeChecked();
    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await expect(cards.nth(0).locator('.time-readout')).toHaveText('25:00');
    await expect(cards.nth(1).locator('.time-readout')).toHaveText('05:00');
});

test('a hand-written multi-card link reconstructs exactly what it specifies', async ({ page }) => {
    await page.goto('/index.html?h1_minutes=45&h1_color=rose&h1_label=Reading&h2_minutes=10&auto=1');

    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.time-readout')).toHaveText('45:00');
    await expect(cards.nth(0).locator('.card-label')).toHaveText('Reading');
    await expect(cards.nth(1).locator('.time-readout')).toHaveText('10:00');
    await expect(page.locator('#autoModeToggle')).toBeChecked();

    // h2 never specified a color — must auto-pick something distinct from h1's explicit "rose"
    const color1 = await cards.nth(0).evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    const color2 = await cards.nth(1).evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    expect(color1).toBe('hsl(336 68% 55%)'); // rose, as explicitly requested
    expect(color1).not.toBe(color2);
});

test('garbage/invalid param values fall back gracefully instead of erroring', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/index.html?minutes=5&color=not-a-real-color&sound=not-a-real-sound&h1_minutes=not-a-number');
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(1);
    expect(errors).toEqual([]);
});
