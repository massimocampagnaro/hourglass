/* ============================================================
   embed/embed.js — minimal widget wiring: hourglass + time only.
   ============================================================ */

(function () {
    'use strict';

    const wrap = document.getElementById('hourglassWrap');
    const shell = document.getElementById('hourglassShell');
    const timeReadout = document.getElementById('timeReadout');

    const params = new URLSearchParams(window.location.search);

    // ?theme=light for a light host page — only the time text's color changes (see css/embed.css).
    if (params.get('theme') === 'light') {
        document.body.dataset.theme = 'light';
    }

    // Both off by default — no in-widget control to toggle them.
    const soundEnabled = params.get('sound') === '1';
    const keepSand = params.get('keepsand') === '1'; // same as the main app's "keep sand on flip" toggle

    // The host page is more likely than this frame to already have a user gesture unlocking audio
    // (see README), so it gets first refusal on alerting via postMessage; playDoneSound() below
    // still runs too, as a best-effort bonus.
    function postToHost(type) {
        if (window.parent === window) return; // not actually embedded — no one to tell
        window.parent.postMessage({ source: 'hourglass-embed', type }, '*');
    }

    const glass = new Hourglass(wrap);
    glass.resetOnFlip = !keepSand;

    glass.onTick = (remainingMs) => {
        timeReadout.textContent = HourglassShared.formatTime(remainingMs);
    };

    glass.onDone = () => {
        timeReadout.classList.add('is-done');
        if (soundEnabled) HourglassShared.playDoneSound();
        postToHost('done');
    };

    shell.addEventListener('click', () => {
        timeReadout.classList.remove('is-done');
        glass.flip();
    });

    const { minutes, autostart } = HourglassShared.readTimerParams(window.location.search);
    glass.setDuration(minutes);
    if (autostart) glass.start();
})();
