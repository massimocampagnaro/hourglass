/* ============================================================
   js/timer-worker.js — background-safe alarm clock.
   Dedicated Workers aren't subject to the same background-tab
   timer throttling as the document context, so a `setTimeout`
   scheduled here still fires close to on-time while the page is
   hidden. Keyed by id so several hourglasses (and the automatic
   Pomodoro sequence) can each hold their own pending alarm.
   ============================================================ */

'use strict';

const pendingTimeouts = new Map(); // id -> timeoutId

function clearPending(id) {
    const timeoutId = pendingTimeouts.get(id);
    if (timeoutId != null) {
        clearTimeout(timeoutId);
        pendingTimeouts.delete(id);
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
        }, Math.max(0, remainingMs) || 0);
        pendingTimeouts.set(id, timeoutId);
    } else if (type === 'stop') {
        clearPending(id);
    }
};
