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

    const glass = new Hourglass(wrap);
    glass.resetOnFlip = true;

    glass.onTick = (remainingMs) => {
        timeReadout.textContent = HourglassShared.formatTime(remainingMs);
    };

    glass.onDone = () => {
        timeReadout.classList.add('is-done');
    };

    shell.addEventListener('click', () => {
        timeReadout.classList.remove('is-done');
        glass.flip();
    });

    const { minutes, autostart } = HourglassShared.readTimerParams(window.location.search);
    glass.setDuration(minutes);
    if (autostart) glass.start();
})();
