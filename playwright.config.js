// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        screenshot: 'only-on-failure',
    },
    webServer: {
        // Plain static server (no extra dependency) — the app is vanilla
        // HTML/CSS/JS with no build step, so anything that serves the
        // repo root over HTTP works.
        command: 'python3 -m http.server 4173 --bind 127.0.0.1',
        url: 'http://127.0.0.1:4173/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 20000,
    },
});
