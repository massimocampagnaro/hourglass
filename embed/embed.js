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

    // ?show=hourglass|time to drop one half of the widget (see css/embed.css); default shows both.
    // "time" still runs the full hourglass underneath, just hidden — it drives onTick/onDone either way.
    const showParam = params.get('show');
    if (showParam === 'hourglass' || showParam === 'time') {
        document.body.dataset.show = showParam;
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

    const { minutes, autostart, delaySeconds } = HourglassShared.readTimerParams(window.location.search);
    glass.setDuration(minutes);
    if (autostart) {
        if (delaySeconds > 0) setTimeout(() => glass.start(), delaySeconds * 1000);
        else glass.start();
    }
})();
