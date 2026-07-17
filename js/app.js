/* ============================================================
   js/app.js — page chrome + orchestration for the hourglass row.
   The row itself (cards, Pomodoro preset, automatic-mode
   sequencer) is owned by js/cards.js; this file wires that
   manager up to the header controls (mute, keep-sand-on-flip,
   Pomodoro button, automatic-mode toggle), the popout button,
   and keyboard shortcuts.
   ============================================================ */

(function () {
    'use strict';

    const rowEl = document.getElementById('hourglassRow');
    const popOutBtn = document.getElementById('popOutBtn');
    const muteBtn = document.getElementById('muteBtn');
    const physicalFlipToggle = document.getElementById('physicalFlipToggle');
    const pomodoroBtn = document.getElementById('pomodoroBtn');
    const autoModeToggle = document.getElementById('autoModeToggle');

    // Whether to reset on flip and whether sound is muted are personal,
    // ongoing preferences (not something you'd want to share via a link),
    // so they live in localStorage rather than the URL — set once and
    // remembered silently across reloads. See the (identical) rationale
    // this carries over from the Phase 1 single-hourglass version.
    const RESET_ON_FLIP_STORAGE_KEY = 'hourglass:resetOnFlip';
    const MUTED_STORAGE_KEY = 'hourglass:muted';

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

    function loadMutedPreference() {
        try {
            return localStorage.getItem(MUTED_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    function saveMutedPreference(muted) {
        try {
            localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0');
        } catch {
            // ignore
        }
    }

    let muted = loadMutedPreference();
    const resetOnFlip = loadResetOnFlipPreference();
    physicalFlipToggle.checked = !resetOnFlip;

    const VOLUME_ON_SVG = '<svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false"><path d="M760-481q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131.5T840-481q0 108-58 196.5T627-153q-16 7-31.5 0T574-176q-5-15 2-29.5t22-21.5q74-34 118-102.5T760-481ZM280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm380-120q0 42-19 79.5T591-339q-10 6-20.5.5T560-356v-250q0-12 10.5-17.5t20.5.5q31 25 50 63t19 80ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>';
    const VOLUME_OFF_SVG = '<svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false"><path d="m720-424-76 76q-11 11-28 11t-28-11q-11-11-11-28t11-28l76-76-76-76q-11-11-11-28t11-28q11-11 28-11t28 11l76 76 76-76q11-11 28-11t28 11q11 11 11 28t-11 28l-76 76 76 76q11 11 11 28t-11 28q-11 11-28 11t-28-11l-76-76Zm-440 64H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm120-246-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>';

    function syncMuteButton() {
        muteBtn.innerHTML = muted ? VOLUME_OFF_SVG : VOLUME_ON_SVG;
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.setAttribute('aria-label', muted ? 'Unmute done sound' : 'Mute done sound');
    }
    syncMuteButton();

    const cardManager = HourglassCards.createCardManager(rowEl, {
        muted,
        resetOnFlip,
        onChange: () => {
            autoModeToggle.checked = cardManager.isAutoMode();
            syncUrl();
        },
    });

    muteBtn.addEventListener('click', () => {
        muted = !muted;
        saveMutedPreference(muted);
        syncMuteButton();
        cardManager.setMuted(muted);
    });

    physicalFlipToggle.addEventListener('change', () => {
        const nextResetOnFlip = !physicalFlipToggle.checked;
        saveResetOnFlipPreference(nextResetOnFlip);
        cardManager.setResetOnFlip(nextResetOnFlip);
    });

    pomodoroBtn.addEventListener('click', () => {
        cardManager.applyPomodoroPreset();
        autoModeToggle.checked = true;
    });

    autoModeToggle.addEventListener('change', () => {
        cardManager.setAutoMode(autoModeToggle.checked);
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

    // Mirrors the whole row into the address bar so the page can be
    // bookmarked or shared as-is — one hourglass keeps the original flat
    // ?minutes=&autostart= contract (plus the new &color=&sound=&label=,
    // each omitted when it's just the default so an untouched single
    // card still produces the same minimal URL as before); two or three
    // use the indexed h1_/h2_/h3_ form. See HourglassShared.readCardsFromParams
    // for the matching read side.
    const DEFAULT_COLOR_ID = HourglassShared.COLOR_PALETTE[0].id;

    function syncUrl() {
        const cards = cardManager.getCardsSnapshot();
        const params = new URLSearchParams();
        if (cardManager.isAutoMode()) params.set('auto', '1');

        if (cards.length === 1) {
            const card = cards[0];
            params.set('minutes', String(card.minutes));
            if (card.colorId !== DEFAULT_COLOR_ID) params.set('color', card.colorId);
            if (card.soundId !== HourglassShared.DEFAULT_SOUND_ID) params.set('sound', card.soundId);
            if (card.label) params.set('label', card.label);
            if (card.running) params.set('autostart', '1');
        } else {
            cards.forEach((card, i) => {
                const prefix = `h${i + 1}_`;
                params.set(prefix + 'minutes', String(card.minutes));
                params.set(prefix + 'color', card.colorId);
                params.set(prefix + 'sound', card.soundId);
                if (card.label) params.set(prefix + 'label', card.label);
            });
        }
        history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    }

    document.addEventListener('keydown', (e) => {
        // Skip whenever focus is on a control that already has its own
        // keyboard handling (typing, or Space/Enter activating a button) —
        // otherwise Space would both natively activate the focused button
        // AND trigger a shortcut here, firing two different actions.
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.code === 'Space') {
            e.preventDefault();
            cardManager.handleKeyToggle();
            syncUrl();
        } else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            cardManager.handleKeyReset();
            syncUrl();
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            cardManager.handleKeyFlip();
            syncUrl();
        }
    });

    // Optional query params so the whole row can be shared/bookmarked
    // pre-configured, e.g. link.html?minutes=25&autostart=1&color=ember
    // for a one-tap custom start, or link.html?h1_minutes=25&h1_label=Focus
    // &h2_minutes=5&h2_label=Break&auto=1 for a from-scratch Pomodoro link.
    // See HourglassShared.readCardsFromParams for the full contract —
    // shared with embed/embed.js only for the ?minutes=&autostart= part,
    // so the two entry points can't drift apart on that shared subset.
    const { cards: initialCardConfigs, autoMode: initialAutoMode } =
        HourglassShared.readCardsFromParams(window.location.search);
    cardManager.addCardsFromConfigs(initialCardConfigs);
    if (initialAutoMode) {
        cardManager.setAutoMode(true);
        autoModeToggle.checked = true;
    }
    syncUrl();
})();
