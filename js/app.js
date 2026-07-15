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
    const popOutBtn = document.getElementById('popOutBtn');
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

    const VOLUME_ON_SVG = '<svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false"><path d="M760-481q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131.5T840-481q0 108-58 196.5T627-153q-16 7-31.5 0T574-176q-5-15 2-29.5t22-21.5q74-34 118-102.5T760-481ZM280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm380-120q0 42-19 79.5T591-339q-10 6-20.5.5T560-356v-250q0-12 10.5-17.5t20.5.5q31 25 50 63t19 80ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>';
    const VOLUME_OFF_SVG = '<svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false"><path d="m720-424-76 76q-11 11-28 11t-28-11q-11-11-11-28t11-28l76-76-76-76q-11-11-11-28t11-28q11-11 28-11t28 11l76 76 76-76q11-11 28-11t28 11q11 11 11 28t-11 28l-76 76 76 76q11 11 11 28t-11 28q-11 11-28 11t-28-11l-76-76Zm-440 64H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm120-246-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>';

    function syncMuteButton() {
        muteBtn.innerHTML = muted ? VOLUME_OFF_SVG : VOLUME_ON_SVG;
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

    // Open popup in a new tab with fixed position and dimensions
    popOutBtn.addEventListener('click', () => {
        const width = 380;
        const height = Math.min(1080, window.screen.availHeight);
        const left = Math.max(0, window.screen.availWidth - width);
        const popupUrl = new URL(window.location.href);
        popupUrl.searchParams.set('popout', '0');
        window.open(popupUrl, 'hourglassPopout', `width=${width},height=${height},left=${left},top=0`);
    });

    if (new URLSearchParams(window.location.search).get('popout') === '0') {
        popOutBtn.hidden = true;
        document.documentElement.classList.add('is-popout'); // sized to fit exactly, no scrollbar needed
    }

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
