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

    // How much smaller/bigger a card's hourglass renders based on its
    // duration, relative to a 60-minute reference. Deliberately damped
    // (sqrt, plus a high floor) so a 5-minute glass reads as clearly
    // shorter than a 25-minute one without looking like a toy next to it —
    // proportion should be *felt*, not literal (5 min isn't 1/5 the size).
    const SIZE_SCALE_REFERENCE_MINUTES = 60;
    const SIZE_SCALE_MIN = 0.55;
    const SIZE_SCALE_MAX = 1.15;

    function sizeScaleForMinutes(minutes) {
        const m = clampMinutes(minutes);
        const raw = 0.65 + 0.35 * Math.sqrt(m / SIZE_SCALE_REFERENCE_MINUTES);
        return Math.max(SIZE_SCALE_MIN, Math.min(SIZE_SCALE_MAX, raw));
    }

    // Curated sand colors, selectable per hourglass. Each entry resolves to
    // the same three CSS custom properties the SVG gradients already read
    // (--color-sand / -light / -dark), just scoped to one card instead of
    // :root. "amber" keeps the exact original hex triplet so the default
    // look never shifts; every other entry is derived from a single hue so
    // they all share the same saturation/lightness "feel" as amber.
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

    // Fixed colors for the Pomodoro preset: warm red for the focus session,
    // green for the break — the classic pairing, independent of whatever
    // order COLOR_PALETTE happens to list its entries in.
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

    // Predefined per-hourglass done sounds. Only sounds/done.mp3 exists in
    // the repo today; done2/done3 are referenced ahead of time (paths a
    // future asset drop can fill in) — playSound() already swallows a 404
    // via the same .catch(() => {}) as a blocked autoplay, so picking an
    // as-yet-missing sound just stays silent instead of erroring.
    const SOUND_IDS = ['done', 'done2', 'done3'];
    const DEFAULT_SOUND_ID = 'done';

    // document.currentScript is only valid while this script first runs
    // synchronously — captured once, up front, since soundUrl() below is
    // called later from click/timer handlers, long after that's gone null.
    // Resolved relative to this script's own file, not the page — index.html
    // and embed/index.html live in different folders.
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

    window.HourglassShared = {
        formatTime, clampMinutes, readTimerParams, playDoneSound,
        sizeScaleForMinutes,
        COLOR_PALETTE, resolveColor, POMODORO_FOCUS_COLOR_ID, POMODORO_BREAK_COLOR_ID,
        SOUND_IDS, DEFAULT_SOUND_ID, playSound,
    };
})();
