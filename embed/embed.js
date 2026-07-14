/* ============================================================
   embed/embed.js — minimal widget wiring: hourglass + time only.
   Shares the timer engine (js/hourglass.js) and the ?minutes=&
   autostart= param contract (js/shared.js) with the full app —
   see js/app.js for the presets/input/toggle/keyboard shortcuts
   this intentionally omits.
   ============================================================ */

(function () {
    'use strict';

    const wrap = document.getElementById('hourglassWrap');
    const shell = document.getElementById('hourglassShell');
    const timeReadout = document.getElementById('timeReadout');

    const params = new URLSearchParams(window.location.search);

    // ?theme=light for embedding on a light host page — only the time
    // text's color changes (see css/embed.css), the hourglass itself
    // stays the same on either theme.
    if (params.get('theme') === 'light') {
        document.body.dataset.theme = 'light';
    }

    // Both off by default — no in-widget control to toggle them.
    const soundEnabled = params.get('sound') === '1';
    const keepSand = params.get('keepsand') === '1'; // same as the main app's "keep sand on flip" toggle

    const glass = new Hourglass(wrap);
    glass.resetOnFlip = !keepSand;

    glass.onTick = (remainingMs) => {
        timeReadout.textContent = HourglassShared.formatTime(remainingMs);
    };

    glass.onDone = () => {
        timeReadout.classList.add('is-done');
        if (soundEnabled) HourglassShared.playDoneSound();
    };

    shell.addEventListener('click', () => {
        timeReadout.classList.remove('is-done');
        glass.flip();
    });

    const { minutes, autostart } = HourglassShared.readTimerParams(window.location.search);
    glass.setDuration(minutes);
    if (autostart) glass.start();
})();
