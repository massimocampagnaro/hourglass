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

    // "Reset sand on flip" is a personal, ongoing preference (not something
    // you'd want to share via a link), so it lives in localStorage rather
    // than the URL — set once, remembered silently across reloads.
    const RESET_ON_FLIP_STORAGE_KEY = 'hourglass:resetOnFlip';

    function loadResetOnFlipPreference() {
        try {
            return localStorage.getItem(RESET_ON_FLIP_STORAGE_KEY) === '1';
        } catch {
            return false; // storage unavailable (private browsing, quota, etc.)
        }
    }

    function saveResetOnFlipPreference(enabled) {
        try {
            localStorage.setItem(RESET_ON_FLIP_STORAGE_KEY, enabled ? '1' : '0');
        } catch {
            // ignore — nothing useful to do if storage is unavailable
        }
    }

    const glass = new Hourglass(wrap);
    resetOnFlipToggle.checked = loadResetOnFlipPreference();
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

    // Mirrors the current minutes/running state into the address bar so the
    // page can be bookmarked or shared as-is. Uses replaceState (not
    // pushState) so this never touches browser history — otherwise every
    // preset click or start/pause would add a back-button stop.
    //
    // `forceRunning` exists because glass.flip() resumes asynchronously
    // (it pauses immediately, then restarts once the spin/pour finishes) —
    // reading glass.running right after calling flip() would catch that
    // brief paused instant and wrongly drop autostart, even though a flip
    // always ends up running again.
    function syncUrl(forceRunning) {
        const params = new URLSearchParams();
        params.set('minutes', durationInput.value);
        if (forceRunning || glass.running) params.set('autostart', '1');
        history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
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
        syncUrl();
    });

    resetBtn.addEventListener('click', () => {
        glass.reset();
        startPauseBtn.textContent = 'Start';
        timeReadout.classList.remove('is-done');
        syncUrl();
    });

    shell.addEventListener('click', () => {
        timeReadout.classList.remove('is-done');
        glass.flip();
        startPauseBtn.textContent = 'Pause';
        syncUrl(true); // flip always ends up running, even though glass.running lags behind
    });

    resetOnFlipToggle.addEventListener('change', () => {
        glass.resetOnFlip = resetOnFlipToggle.checked;
        saveResetOnFlipPreference(resetOnFlipToggle.checked);
    });

    durationInput.addEventListener('change', () => {
        const val = parseInt(durationInput.value, 10);
        if (!Number.isNaN(val)) setMinutes(val);
        syncUrl();
    });

    presetRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.preset-btn');
        if (!btn) return;
        setMinutes(Number(btn.dataset.minutes));
        syncUrl();
    });

    document.addEventListener('keydown', (e) => {
        // Skip whenever focus is on a control that already has its own
        // keyboard handling (typing, or Space/Enter activating a button) —
        // otherwise Space would both natively activate the focused button
        // AND trigger startPauseBtn here, firing two different actions.
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.code === 'Space') {
            e.preventDefault();
            startPauseBtn.click();
        } else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            resetBtn.click();
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            shell.click();
        }
    });

    // Optional query params so a timer can be shared/bookmarked pre-configured,
    // e.g. link.html?minutes=25&autostart=1 for a one-tap Pomodoro start.
    // Both are independent and optional — omitting either just falls back
    // to the normal default (5 min, not running).
    const urlParams = new URLSearchParams(window.location.search);
    const minutesParam = parseInt(urlParams.get('minutes'), 10);
    setMinutes(Number.isFinite(minutesParam) ? minutesParam : 5);

    const autostartParam = urlParams.get('autostart');
    if (autostartParam === '1' || autostartParam === 'true') {
        glass.start();
        startPauseBtn.textContent = 'Pause';
    }
})();
