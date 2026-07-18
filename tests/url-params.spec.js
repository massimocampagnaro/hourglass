// The URL mirrors the row's state (js/app.js syncUrl), so a copied link restores it.
const { test, expect } = require('@playwright/test');

test('default load produces a minimal, packed URL', async ({ page }) => {
    await page.goto('/index.html');
    const url = new URL(page.url());
    expect(url.searchParams.has('p')).toBe(true);
    // the app only ever writes the packed param now — no more verbose minutes=/color=/etc.
    expect(url.searchParams.has('minutes')).toBe(false);

    const decoded = await page.evaluate(
        (search) => window.HourglassLinkCodec.readCardsFromSearch(search), url.search);
    expect(decoded.cards).toHaveLength(1);
    expect(decoded.cards[0].minutes).toBe(5);
});

test('customizing the single card updates the packed URL, and reloading it restores the config', async ({ page }) => {
    await page.goto('/index.html');
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await card.locator('[data-action="edit"]').click();
    await page.locator('.hourglass-card.is-configuring .swatch-btn[data-color-id="azure"]').click();
    await page.locator('.hourglass-card.is-configuring .sound-btn[data-sound-id="done2"]').click();
    await page.locator('.hourglass-card.is-configuring .card-label-input').fill('Deep Work');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    const url = new URL(page.url());
    const decoded = await page.evaluate(
        (search) => window.HourglassLinkCodec.readCardsFromSearch(search), url.search);
    expect(decoded.cards[0].colorId).toBe('azure');
    expect(decoded.cards[0].soundId).toBe('done2');
    expect(decoded.cards[0].label).toBe('Deep Work');

    await page.goto(page.url());
    await expect(page.locator('.card-label')).toHaveText('Deep Work');
    const restoredColor = await page.locator('.hourglass-card:not(.hourglass-card--add)').first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-sand').trim());
    expect(restoredColor).toContain('205'); // azure's hue
});

test('a multi-card row packs into a much shorter URL and round-trips through a reload', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('.hourglass-card--add').click();
    await page.locator('.hourglass-card.is-configuring .duration-input').fill('45');
    await page.locator('.hourglass-card.is-configuring .card-label-input').fill('Reading time');
    await page.locator('.hourglass-card.is-configuring [data-action="save"]').click();

    const packedUrl = page.url();
    // sanity: shorter than the old indexed h1_/h2_ contract would have produced for the same row
    expect(new URL(packedUrl).search.length).toBeLessThan(60);

    await page.goto(packedUrl);
    const cards = page.locator('.hourglass-card:not(.hourglass-card--add)');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(1).locator('.time-readout')).toHaveText('45:00');
    await expect(cards.nth(1).locator('.card-label')).toHaveText('Reading time');
});

test('legacy ?minutes=&autostart= links still set the duration, but autostart is a no-op now', async ({ page }) => {
    await page.goto('/index.html?minutes=17&autostart=1');
    const card = page.locator('.hourglass-card:not(.hourglass-card--add)').first();
    await expect(card.locator('.time-readout')).toHaveText('17:00');
    await expect(card.locator('[data-action="toggle"]')).toHaveAttribute('aria-label', 'Start');
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

test('buildVerboseSearchParams still round-trips through readCardsFromParams (kept for embedding/hand-written links)', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate(() => {
        const cards = [
            { minutes: 45, colorId: 'azure', soundId: 'done2', label: 'Reading' },
            { minutes: 10, colorId: 'emerald', soundId: 'done', label: '' },
        ];
        const search = '?' + window.HourglassShared.buildVerboseSearchParams(cards, true).toString();
        return { search, decoded: window.HourglassShared.readCardsFromParams(search) };
    });
    expect(result.search).toContain('h1_minutes=45');
    expect(result.search).toContain('auto=1');
    expect(result.decoded.autoMode).toBe(true);
    expect(result.decoded.cards).toEqual([
        { minutes: 45, colorId: 'azure', soundId: 'done2', label: 'Reading' },
        { minutes: 10, colorId: 'emerald', soundId: 'done', label: '' },
    ]);
});

test('a corrupted packed ?p= value falls back to the default card instead of erroring', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/index.html?p=garbage-not-a-real-token');
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)')).toHaveCount(1);
    await expect(page.locator('.hourglass-card:not(.hourglass-card--add)').first().locator('.time-readout'))
        .toHaveText('05:00');
    expect(errors).toEqual([]);
});
