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
    const muteBtn = document.getElementById('muteBtn');
    const timeReadout = document.getElementById('timeReadout');
    const physicalFlipToggle = document.getElementById('physicalFlipToggle');

    // Whether to reset on flip is a personal, ongoing preference (not
    // something you'd want to share via a link), so it lives in
    // localStorage rather than the URL — set once, remembered silently
    // across reloads.
    //
    // Default is reset-on-flip: for a Pomodoro-style timer, "flip = start
    // the next session fresh" is the expected behavior (like turning over
    // a kitchen timer). The toggle is the opt-in exception — flip the
    // hourglass but let the sand actually pour across for real, mirroring
    // however much time was left — so it reads naturally unchecked
    // (= default) / checked (= this fancier opt-in mode), rather than
    // shipping a checkbox that's already ticked the first time you see it.
    const RESET_ON_FLIP_STORAGE_KEY = 'hourglass:resetOnFlip';

    function loadResetOnFlipPreference() {
        try {
            const stored = localStorage.getItem(RESET_ON_FLIP_STORAGE_KEY);
            return stored === null ? true : stored === '1';
        } catch {
            return true; // storage unavailable (private browsing, quota, etc.)
        }
    }

    function saveResetOnFlipPreference(enabled) {
        try {
            localStorage.setItem(RESET_ON_FLIP_STORAGE_KEY, enabled ? '1' : '0');
        } catch {
            // ignore — nothing useful to do if storage is unavailable
        }
    }

    // Same rationale as RESET_ON_FLIP_STORAGE_KEY: personal preference, not shareable via URL.
    const MUTED_STORAGE_KEY = 'hourglass:muted';

    function loadMutedPreference() {
        try {
            return localStorage.getItem(MUTED_STORAGE_KEY) === '1';
        } catch {
            return false; // storage unavailable (private browsing, quota, etc.)
        }
    }

    function saveMutedPreference(muted) {
        try {
            localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0');
        } catch {
            // ignore — nothing useful to do if storage is unavailable
        }
    }

    const glass = new Hourglass(wrap);
    const resetOnFlip = loadResetOnFlipPreference();
    physicalFlipToggle.checked = !resetOnFlip;
    glass.resetOnFlip = resetOnFlip;

    let muted = loadMutedPreference();

    function syncMuteButton() {
        muteBtn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.setAttribute('aria-label', muted ? 'Unmute done sound' : 'Mute done sound');
    }
    syncMuteButton();

    muteBtn.addEventListener('click', () => {
        muted = !muted;
        saveMutedPreference(muted);
        syncMuteButton();
    });

    function syncPresetButtons(minutes) {
        presetRow.querySelectorAll('.preset-btn').forEach((btn) => {
            btn.classList.toggle('is-active', Number(btn.dataset.minutes) === minutes);
        });
    }

    function setMinutes(minutes) {
        minutes = HourglassShared.clampMinutes(minutes);
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
        timeReadout.textContent = HourglassShared.formatTime(remainingMs);
    };

    glass.onDone = () => {
        startPauseBtn.textContent = 'Start';
        timeReadout.classList.add('is-done');
        if (!muted) HourglassShared.playDoneSound();
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

    physicalFlipToggle.addEventListener('change', () => {
        const nextResetOnFlip = !physicalFlipToggle.checked;
        glass.resetOnFlip = nextResetOnFlip;
        saveResetOnFlipPreference(nextResetOnFlip);
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
    // to the normal default (5 min, not running). Shared with embed/embed.js
    // so the two entry points read the same contract.
    const { minutes: initialMinutes, autostart } = HourglassShared.readTimerParams(window.location.search);
    setMinutes(initialMinutes);

    if (autostart) {
        glass.start();
        startPauseBtn.textContent = 'Pause';
    }
})();
