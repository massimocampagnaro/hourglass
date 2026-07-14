/* ============================================================
   js/shared.js — helpers shared between the full app (js/app.js)
   and the embeddable widget (embed/embed.js), so the ?minutes=&
   autostart= param contract can't drift between the two.
   ============================================================ */

(function () {
    'use strict';

    function formatTime(ms) {
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function clampMinutes(minutes) {
        return Math.max(1, Math.min(180, Math.round(minutes)));
    }

    function readTimerParams(search) {
        const urlParams = new URLSearchParams(search);
        const minutesParam = parseInt(urlParams.get('minutes'), 10);
        const minutes = clampMinutes(Number.isFinite(minutesParam) ? minutesParam : 5);
        const autostartParam = urlParams.get('autostart');
        const autostart = autostartParam === '1' || autostartParam === 'true';
        return { minutes, autostart };
    }

    // Resolved relative to this script's own file, not the page — index.html
    // and embed/index.html live in different folders.
    const DONE_SOUND_URL = new URL('../sounds/done.mp3', document.currentScript.src);
    let doneSound = null;

    function playDoneSound() {
        if (!doneSound) doneSound = new Audio(DONE_SOUND_URL);
        doneSound.currentTime = 0;
        doneSound.play().catch(() => {}); // blocked without a prior user gesture
    }

    window.HourglassShared = { formatTime, clampMinutes, readTimerParams, playDoneSound };
})();
