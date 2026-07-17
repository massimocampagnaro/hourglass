/* ============================================================
   js/app.js — page chrome: wires js/cards.js up to the header
   controls, the popout button, and keyboard shortcuts.
   ============================================================ */

(function () {
    'use strict';

    const rowEl = document.getElementById('hourglassRow');
    const popOutBtn = document.getElementById('popOutBtn');
    const shareBtn = document.getElementById('shareBtn');
    const muteBtn = document.getElementById('muteBtn');
    const physicalFlipToggle = document.getElementById('physicalFlipToggle');
    const pomodoroBtn = document.getElementById('pomodoroBtn');
    const autoModeRow = document.getElementById('autoModeRow');
    const autoModeToggle = document.getElementById('autoModeToggle');

    // Personal preferences, not shareable via link — localStorage, not the URL.
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

    const SHARE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">'
        + '<line x1="6" y1="12" x2="18" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
        + '<line x1="6" y1="12" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
        + '<circle cx="6" cy="12" r="2.6" fill="currentColor"/><circle cx="18" cy="6" r="2.6" fill="currentColor"/>'
        + '<circle cx="18" cy="18" r="2.6" fill="currentColor"/></svg>';
    const SHARE_COPIED_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">'
        + '<path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const SHARE_FEEDBACK_MS = 1600;

    shareBtn.innerHTML = SHARE_SVG;
    let shareFeedbackTimeoutId = null;

    function flashShareCopied() {
        shareBtn.innerHTML = SHARE_COPIED_SVG;
        shareBtn.dataset.copied = 'true';
        shareBtn.setAttribute('aria-label', 'Link copied');
        if (shareFeedbackTimeoutId) clearTimeout(shareFeedbackTimeoutId);
        shareFeedbackTimeoutId = setTimeout(() => {
            shareBtn.innerHTML = SHARE_SVG;
            delete shareBtn.dataset.copied;
            shareBtn.setAttribute('aria-label', 'Copy shareable link');
            shareFeedbackTimeoutId = null;
        }, SHARE_FEEDBACK_MS);
    }

    // Automatic mode needs 2+ cards; cardManager already refuses to turn it on with one — this just hides the toggle to match.
    function syncAutoModeVisibility() {
        autoModeRow.hidden = cardManager.getCardCount() <= 1;
    }

    const cardManager = HourglassCards.createCardManager(rowEl, {
        muted,
        resetOnFlip,
        onChange: () => {
            autoModeToggle.checked = cardManager.isAutoMode();
            syncAutoModeVisibility();
            syncUrl();
        },
    });

    muteBtn.addEventListener('click', () => {
        muted = !muted;
        saveMutedPreference(muted);
        syncMuteButton();
        cardManager.setMuted(muted);
    });

    // Native share sheet where available (mostly mobile); otherwise copy the link to the clipboard.
    // The address bar already holds the packed ?p= link (syncUrl), so this is always shareable as-is.
    shareBtn.addEventListener('click', async () => {
        const url = window.location.href;
        if (navigator.share) {
            try {
                await navigator.share({ url, title: document.title });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return; // user dismissed the native sheet — leave it at that
                // any other failure (e.g. unsupported) — fall through and try the clipboard instead
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            flashShareCopied();
        } catch {
            // clipboard blocked (permissions, insecure context) — nothing more we can do silently
        }
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

    // Mirrors the row into the URL as the compact `p=` format (see js/link-codec.js) — the
    // verbose flat/indexed contract in js/shared.js still reads fine, it's just no longer written.
    function syncUrl() {
        const cards = cardManager.getCardsSnapshot();
        const params = new URLSearchParams();
        params.set(HourglassLinkCodec.LINK_PARAM, HourglassLinkCodec.encodeLinkParam(cards, cardManager.isAutoMode()));
        history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    }

    document.addEventListener('keydown', (e) => {
        // Skip controls with their own keyboard handling, or Space would both activate a focused button and trigger a shortcut here.
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

    // e.g. ?p=10-130ea (compact) or ?minutes=25&color=ember or ?h1_minutes=25&h1_label=Focus&h2_minutes=5&h2_label=Break&auto=1
    const { cards: initialCardConfigs, autoMode: initialAutoMode } =
        HourglassLinkCodec.readCardsFromSearch(window.location.search);
    cardManager.addCardsFromConfigs(initialCardConfigs);
    if (initialAutoMode) {
        cardManager.setAutoMode(true);
        autoModeToggle.checked = true;
    }
    syncUrl();
})();
