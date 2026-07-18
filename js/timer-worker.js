/* ============================================================
   js/timer-worker.js — background-safe alarm clock.
   Dedicated Workers aren't subject to the same background-tab
   timer throttling as the document context, so a `setTimeout`
   scheduled here still fires close to on-time while the page is
   hidden. Keyed by id so several hourglasses (and the automatic
   Pomodoro sequence) can each hold their own pending alarm.
   ============================================================ */

'use strict';

const TICK_INTERVAL_MS = 1000;

const pendingTimeouts = new Map(); // id -> timeoutId
let tickIntervalId = null;

function clearPending(id) {
    const timeoutId = pendingTimeouts.get(id);
    if (timeoutId != null) {
        clearTimeout(timeoutId);
        pendingTimeouts.delete(id);
    }
}

// On while anything's pending — lets a hidden tab resync things like its title once a second,
// without depending on rAF (which stops entirely once hidden).
function syncTicking() {
    const shouldTick = pendingTimeouts.size > 0;
    if (shouldTick && tickIntervalId == null) {
        tickIntervalId = setInterval(() => self.postMessage({ type: 'tick' }), TICK_INTERVAL_MS);
    } else if (!shouldTick && tickIntervalId != null) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
    }
}

self.onmessage = (event) => {
    const { type, id, remainingMs } = event.data || {};
    if (!id) return;

    if (type === 'start') {
        clearPending(id);
        const timeoutId = setTimeout(() => {
            pendingTimeouts.delete(id);
            self.postMessage({ type: 'done', id });
            syncTicking();
        }, Math.max(0, remainingMs) || 0);
        pendingTimeouts.set(id, timeoutId);
        syncTicking();
    } else if (type === 'stop') {
        clearPending(id);
        syncTicking();
    }
};
