/* ============================================================
   js/shared.js — helpers shared between js/app.js and embed/embed.js.
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

    // Hard cap on cards per row — also the bound for the h1_/h2_/h3_ URL params below.
    const MAX_CARDS = 3;

    function readTimerParams(search) {
        const urlParams = new URLSearchParams(search);
        const minutesParam = parseInt(urlParams.get('minutes'), 10);
        const minutes = clampMinutes(Number.isFinite(minutesParam) ? minutesParam : 5);
        const autostartParam = urlParams.get('autostart');
        const autostart = autostartParam === '1' || autostartParam === 'true';
        return { minutes, autostart };
    }

    // Damped size scaling (sqrt + high floor) — proportion should be felt, not literal.
    const SIZE_SCALE_REFERENCE_MINUTES = 60;
    const SIZE_SCALE_MIN = 0.55;
    const SIZE_SCALE_MAX = 1.15;

    function sizeScaleForMinutes(minutes) {
        const m = clampMinutes(minutes);
        const raw = 0.65 + 0.35 * Math.sqrt(m / SIZE_SCALE_REFERENCE_MINUTES);
        return Math.max(SIZE_SCALE_MIN, Math.min(SIZE_SCALE_MAX, raw));
    }

    // Curated sand colors. "amber" keeps the original hex triplet as the default; the rest are derived from a single hue each.
    const COLOR_PALETTE = [
        { id: 'amber', name: 'Amber', sand: '#e0a83f', light: '#f3cf7c', dark: '#a86f24' },
        { id: 'ember', name: 'Ember', hue: 8 },
        { id: 'rose', name: 'Rose', hue: 336 },
        { id: 'violet', name: 'Violet', hue: 262 },
        { id: 'azure', name: 'Azure', hue: 205 },
        { id: 'teal', name: 'Teal', hue: 174 },
        { id: 'emerald', name: 'Emerald', hue: 140 },
        { id: 'slate', name: 'Slate', hue: 218, sat: 22 },
    ];

    // Fixed Pomodoro colors: warm red for focus, green for break.
    const POMODORO_FOCUS_COLOR_ID = 'ember';
    const POMODORO_BREAK_COLOR_ID = 'emerald';

    function resolveColor(colorId) {
        const entry = COLOR_PALETTE.find((c) => c.id === colorId) || COLOR_PALETTE[0];
        if (entry.sand) return { sand: entry.sand, light: entry.light, dark: entry.dark };
        const s = entry.sat != null ? entry.sat : 68;
        return {
            sand: `hsl(${entry.hue} ${s}% 55%)`,
            light: `hsl(${entry.hue} ${Math.min(s + 12, 95)}% 72%)`,
            dark: `hsl(${entry.hue} ${Math.max(s - 8, 10)}% 38%)`,
        };
    }

    const SOUND_IDS = ['done', 'done2', 'done3'];
    const DEFAULT_SOUND_ID = 'done';

    // Captured now — document.currentScript is null once called later from click/timer handlers.
    const SCRIPT_URL = document.currentScript.src;

    function soundUrl(soundId) {
        const file = SOUND_IDS.includes(soundId) ? soundId : DEFAULT_SOUND_ID;
        return new URL(`../sounds/${file}.mp3`, SCRIPT_URL);
    }

    const soundCache = new Map();

    function playSound(soundId) {
        const id = SOUND_IDS.includes(soundId) ? soundId : DEFAULT_SOUND_ID;
        let audio = soundCache.get(id);
        if (!audio) {
            audio = new Audio(soundUrl(id));
            soundCache.set(id, audio);
        }
        audio.currentTime = 0;
        audio.play().catch(() => {}); // blocked without a prior user gesture, or file not added yet
    }

    function playDoneSound() {
        playSound(DEFAULT_SOUND_ID);
    }

    function isValidColorId(id) {
        return COLOR_PALETTE.some((c) => c.id === id);
    }

    function isValidSoundId(id) {
        return SOUND_IDS.includes(id);
    }

    function sanitizeLabel(raw) {
        return raw ? raw.slice(0, 16) : '';
    }

    // Row config from the URL: indexed h1_/h2_/h3_ form, or the flat legacy
    // single-card ?minutes=&autostart=&color=&sound=&label= as a fallback.
    // A missing/invalid color or sound comes back null, meaning auto-pick.
    function readCardsFromParams(search) {
        const urlParams = new URLSearchParams(search);
        const autoParam = urlParams.get('auto');
        const autoMode = autoParam === '1' || autoParam === 'true';

        const indexedCards = [];
        for (let n = 1; n <= MAX_CARDS; n++) {
            const prefix = `h${n}_`;
            const hasAny = ['minutes', 'color', 'sound', 'label'].some((key) => urlParams.has(prefix + key));
            if (!hasAny) continue;
            const minutesParam = parseInt(urlParams.get(prefix + 'minutes'), 10);
            const colorParam = urlParams.get(prefix + 'color');
            const soundParam = urlParams.get(prefix + 'sound');
            indexedCards.push({
                minutes: clampMinutes(Number.isFinite(minutesParam) ? minutesParam : 5),
                colorId: isValidColorId(colorParam) ? colorParam : null,
                soundId: isValidSoundId(soundParam) ? soundParam : null,
                label: sanitizeLabel(urlParams.get(prefix + 'label')),
                running: false, // no auto-start concept for multi-card links — see README
            });
        }
        if (indexedCards.length > 0) {
            return { cards: indexedCards, autoMode };
        }

        const { minutes, autostart } = readTimerParams(search);
        const colorParam = urlParams.get('color');
        const soundParam = urlParams.get('sound');
        return {
            cards: [{
                minutes,
                colorId: isValidColorId(colorParam) ? colorParam : null,
                soundId: isValidSoundId(soundParam) ? soundParam : null,
                label: sanitizeLabel(urlParams.get('label')),
                running: autostart,
            }],
            autoMode,
        };
    }

    // Inverse of readCardsFromParams above. Unused by the app itself (syncUrl writes the packed
    // ?p= format instead) — kept for anything that wants an explicit, hand-editable link.
    function buildVerboseSearchParams(cards, autoMode) {
        const params = new URLSearchParams();
        if (autoMode) params.set('auto', '1');

        if (cards.length === 1) {
            const card = cards[0];
            params.set('minutes', String(clampMinutes(card.minutes)));
            if (card.colorId && card.colorId !== COLOR_PALETTE[0].id) params.set('color', card.colorId);
            if (card.soundId && card.soundId !== DEFAULT_SOUND_ID) params.set('sound', card.soundId);
            if (card.label) params.set('label', sanitizeLabel(card.label));
            if (card.running) params.set('autostart', '1');
        } else {
            cards.slice(0, MAX_CARDS).forEach((card, i) => {
                const prefix = `h${i + 1}_`;
                params.set(prefix + 'minutes', String(clampMinutes(card.minutes)));
                params.set(prefix + 'color', card.colorId);
                params.set(prefix + 'sound', card.soundId);
                if (card.label) params.set(prefix + 'label', sanitizeLabel(card.label));
            });
        }
        return params;
    }

    window.HourglassShared = {
        formatTime, clampMinutes, readTimerParams, playDoneSound,
        sizeScaleForMinutes, MAX_CARDS,
        COLOR_PALETTE, resolveColor, POMODORO_FOCUS_COLOR_ID, POMODORO_BREAK_COLOR_ID,
        SOUND_IDS, DEFAULT_SOUND_ID, playSound,
        isValidColorId, isValidSoundId, sanitizeLabel,
        readCardsFromParams, buildVerboseSearchParams,
    };
})();
