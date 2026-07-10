/* ============================================================
   js/app.js — UI wiring for the single hourglass (Phase 1)
   ============================================================ */

(function () {
    'use strict';

    const wrap = document.getElementById('hourglassWrap');
    const shell = document.getElementById('hourglassShell');
    const durationInput = document.getElementById('durationInput');
    const presetRow = document.getElementById('presetRow');
    const startPauseBtn = document.getElementById('startPauseBtn');
    const resetBtn = document.getElementById('resetBtn');
    const timeReadout = document.getElementById('timeReadout');
    const resetOnFlipToggle = document.getElementById('resetOnFlipToggle');

    const glass = new Hourglass(wrap);
    glass.resetOnFlip = resetOnFlipToggle.checked;

    function formatTime(ms) {
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function syncPresetButtons(minutes) {
        presetRow.querySelectorAll('.preset-btn').forEach((btn) => {
            btn.classList.toggle('is-active', Number(btn.dataset.minutes) === minutes);
        });
    }

    function setMinutes(minutes) {
        minutes = Math.max(1, Math.min(180, Math.round(minutes)));
        durationInput.value = minutes;
        syncPresetButtons(minutes);
        glass.setDuration(minutes);
    }

    glass.onTick = (remainingMs) => {
        timeReadout.textContent = formatTime(remainingMs);
    };

    glass.onDone = () => {
        startPauseBtn.textContent = 'Start';
        timeReadout.classList.add('is-done');
    };

    startPauseBtn.addEventListener('click', () => {
        if (glass.running) {
            glass.pause();
            startPauseBtn.textContent = 'Start';
        } else {
            timeReadout.classList.remove('is-done');
            glass.start();
            startPauseBtn.textContent = 'Pause';
        }
    });

    resetBtn.addEventListener('click', () => {
        glass.reset();
        startPauseBtn.textContent = 'Start';
        timeReadout.classList.remove('is-done');
    });

    shell.addEventListener('click', () => {
        timeReadout.classList.remove('is-done');
        glass.flip();
        startPauseBtn.textContent = 'Pause';
    });

    resetOnFlipToggle.addEventListener('change', () => {
        glass.resetOnFlip = resetOnFlipToggle.checked;
    });

    durationInput.addEventListener('change', () => {
        const val = parseInt(durationInput.value, 10);
        if (!Number.isNaN(val)) setMinutes(val);
    });

    presetRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.preset-btn');
        if (!btn) return;
        setMinutes(Number(btn.dataset.minutes));
    });

    setMinutes(5);
})();
