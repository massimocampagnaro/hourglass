/* ============================================================
   js/alarm.js — main-thread side of the background alarm: owns
   the timer Worker and the Notification permission/display, so a
   session finishing while the tab is hidden is still surfaced.
   Main app only (js/app.js + js/cards.js) — the embed widget stays
   deliberately minimal and never prompts for notification access.
   ============================================================ */

(function () {
    'use strict';

    // Captured now — document.currentScript is null once called later from click/timer handlers.
    const SCRIPT_URL = document.currentScript.src;

    // One shared Worker for every hourglass on the page, alarms keyed by card id.
    function createTimerAlarm(onAlarm) {
        let worker = null;
        try {
            worker = new Worker(new URL('timer-worker.js', SCRIPT_URL));
            worker.onmessage = (event) => {
                if (event.data && event.data.type === 'done') onAlarm(event.data.id);
            };
        } catch {
            worker = null; // Workers unavailable (e.g. served over file://) — degrade to foreground-only timing
        }

        return {
            schedule(id, remainingMs) {
                if (worker) worker.postMessage({ type: 'start', id, remainingMs });
            },
            cancel(id) {
                if (worker) worker.postMessage({ type: 'stop', id });
            },
        };
    }

    let permissionRequested = false;

    // Called from a genuine user gesture (starting a timer) — asking on page load would be noise.
    function ensureNotificationPermission() {
        if (permissionRequested) return;
        permissionRequested = true;
        if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
        Notification.requestPermission().catch(() => {});
    }

    // Only worth showing while the tab is actually out of view — otherwise the in-page "done" state already covers it.
    function showDoneNotification(title, body) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (!document.hidden) return;
        try {
            const notification = new Notification(title, { body, tag: 'hourglass-done', renotify: true });
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch {
            // Some platforms (e.g. mobile Chrome) require a Service Worker-backed notification — fail silently.
        }
    }

    window.HourglassAlarm = { createTimerAlarm, ensureNotificationPermission, showDoneNotification };
})();
