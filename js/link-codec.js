/* ============================================================
   js/link-codec.js — compact `p=` link format: packs a row's state
   into a short positional string instead of one query param per
   field, so a 2-3 card link doesn't run to hundreds of characters.
   js/shared.js's verbose params still work for reading — this only
   changes what the app itself writes into the address bar.
   ============================================================ */

(function () {
    'use strict';

    const {
        clampMinutes, sanitizeLabel, MAX_CARDS,
        COLOR_PALETTE, DEFAULT_SOUND_ID, readCardsFromParams,
    } = window.HourglassShared;

    const LINK_PARAM = 'p';
    // Bump only if the layout changes in a way an old parser couldn't read (e.g. wider codes).
    // Unrecognized versions just fall back to the verbose params, so old links never break.
    const FORMAT_VERSION = '1';

    // Single-letter, append-only codes (a-z then A-Z, 52 slots) — never reassign one, or an old
    // link would decode to the wrong color/sound. Kept independent of COLOR_PALETTE's own order,
    // which is free to change for display.
    const COLOR_CODE_BY_ID = {
        amber: 'a', ember: 'b', rose: 'c', violet: 'd',
        azure: 'e', teal: 'f', emerald: 'g', slate: 'h',
    };
    const SOUND_CODE_BY_ID = { done: 'a', done2: 'b', done3: 'c' };

    function invert(obj) {
        const out = {};
        for (const key in obj) out[obj[key]] = key;
        return out;
    }
    const COLOR_ID_BY_CODE = invert(COLOR_CODE_BY_ID);
    const SOUND_ID_BY_CODE = invert(SOUND_CODE_BY_ID);

    const DEFAULT_COLOR_ID = COLOR_PALETTE[0].id;

    // ─── label <-> compact token (base64, "-"-free so it can't collide with CARD_SEPARATOR) ───
    // Standard base64url maps "+" to "-", which would collide with the card separator below —
    // "." instead, same cost, no collision.
    function labelToToken(label) {
        if (!label) return '';
        const bytes = new TextEncoder().encode(label);
        let binary = '';
        bytes.forEach((b) => { binary += String.fromCharCode(b); });
        return btoa(binary).replace(/\+/g, '.').replace(/\//g, '_').replace(/=+$/, '');
    }

    function tokenToLabel(token) {
        if (!token) return '';
        try {
            let base64 = token.replace(/\./g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        } catch {
            return ''; // corrupted/hand-edited token — drop the label rather than throw
        }
    }

    // ─── one card <-> "<minutes><color><sound><label>" ───
    // No autostart field (see readCardsFromParams) and no delimiters needed between the others:
    // color/sound are fixed-width (1 char), minutes self-terminates at the color code, and label
    // — always last — just takes the rest.
    function encodeCard(card) {
        const minutesDigits = String(clampMinutes(card.minutes));
        const colorCode = COLOR_CODE_BY_ID[card.colorId] || COLOR_CODE_BY_ID[DEFAULT_COLOR_ID];
        const soundCode = SOUND_CODE_BY_ID[card.soundId] || SOUND_CODE_BY_ID[DEFAULT_SOUND_ID];
        return minutesDigits + colorCode + soundCode + labelToToken(card.label);
    }

    const CARD_TOKEN_RE = /^(\d{1,3})([a-zA-Z])([a-zA-Z])(.*)$/;

    function decodeCardToken(token) {
        const match = CARD_TOKEN_RE.exec(token);
        if (!match) return null;
        const [, minutesDigits, colorCode, soundCode, labelToken] = match;
        return {
            minutes: clampMinutes(parseInt(minutesDigits, 10)),
            colorId: COLOR_ID_BY_CODE[colorCode] || null, // unknown code (e.g. a newer format) — caller auto-picks
            soundId: SOUND_ID_BY_CODE[soundCode] || null,
            label: sanitizeLabel(tokenToLabel(labelToken)),
        };
    }

    // ─── whole-row encode/decode ───
    const CARD_SEPARATOR = '-'; // safe: the label alphabet above never produces one

    function encodeLinkParam(cards, autoMode) {
        const header = FORMAT_VERSION + (autoMode ? '1' : '0');
        const body = cards.slice(0, MAX_CARDS).map(encodeCard).join(CARD_SEPARATOR);
        return header + body;
    }

    function decodeLinkParam(raw) {
        if (typeof raw !== 'string' || raw.length < 2 || raw[0] !== FORMAT_VERSION) return null;
        const autoMode = raw[1] === '1';
        const cards = raw.slice(2).split(CARD_SEPARATOR).slice(0, MAX_CARDS).map(decodeCardToken).filter(Boolean);
        if (cards.length === 0) return null;
        return { cards, autoMode };
    }

    // Drop-in replacement for HourglassShared.readCardsFromParams: prefers the compact `p=`
    // param when present and well-formed, otherwise falls back to the verbose contract.
    function readCardsFromSearch(search) {
        const raw = new URLSearchParams(search).get(LINK_PARAM);
        const decoded = raw != null ? decodeLinkParam(raw) : null;
        return decoded || readCardsFromParams(search);
    }

    window.HourglassLinkCodec = { LINK_PARAM, encodeLinkParam, readCardsFromSearch };
})();
