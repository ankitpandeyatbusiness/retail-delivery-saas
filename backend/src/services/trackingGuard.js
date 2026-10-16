// Keeps live tracking from ever hurting the server. The apps use sockets while this says "socket" and fall back to light polling
// when it says "polling" or "off" (or when the socket simply cannot connect). Nothing here can throw into a request.
//
//   mode "socket"   normal: new sockets are accepted until the cap
//   mode "polling"  sockets are refused (a clear SERVER_BUSY answer with how long to wait); apps poll every pollSec seconds
//   mode "off"      live tracking is off for everybody
//
// The mode is set by the supreme admin (PlatformSettings.tracking) AND by a watchdog: when the server is struggling
// (the event loop answers late, or memory is nearly full) the watchdog switches to "polling" for a few minutes by itself.
const v8 = require('v8');
const PlatformSettings = require('../models/PlatformSettings');

const DEFAULTS = { mode: 'socket', maxSockets: 400, pollSec: 15 };
const SETTINGS_TTL_MS = 15000;
const AUTO_MS = 2 * 60000;          // how long the watchdog keeps polling mode on
const LAG_LIMIT_MS = 300;           // an event loop that answers 300 ms late 3 times in a row is struggling
const HEAP_LIMIT = 0.85;            // or memory is above 85% of what Node may use

let settings = { ...DEFAULTS, at: 0 };
let auto = { until: 0, reason: '' };
let lag = { last: 0, strikes: 0, max: 0 };
let timer = null;
let onChange = null;
let lastMode = 'socket';
const counters = { refused: 0, pings: 0, droppedPings: 0, httpFallbacks: 0, shed: 0 };
const config = { shedDelayMs: 3000 };   // how long after a switch to polling the open sockets are closed (so apps can read the notice first)

async function loadSettings() {
    if (Date.now() - settings.at < SETTINGS_TTL_MS) return settings;
    try {
        const p = await PlatformSettings.findById('main').select('tracking').lean();
        settings = { ...DEFAULTS, ...(p?.tracking || {}), at: Date.now() };
    } catch (e) { settings.at = Date.now(); }   // keep the last known settings if the database hiccups
    return settings;
}

const autoOn = () => auto.until > Date.now();

// the mode right now, and what an app should do about it
async function status() {
    const s = await loadSettings();
    let mode = s.mode;
    let reason = mode === 'socket' ? '' : 'Switched by the admin';
    if (mode === 'socket' && autoOn()) { mode = 'polling'; reason = auto.reason; }
    return { mode, reason, pollSec: s.pollSec, maxSockets: s.maxSockets, retryAfterSec: mode === 'socket' ? 0 : 60 + Math.floor(Math.random() * 60) };
}

// socket.io middleware: refuses a new connection with a clear answer when sockets are off or the cap is reached.
// Superadmin sockets are never refused (they are few and they are how you look at the server).
function middleware(getCount) {
    return async (socket, next) => {
        try {
            if (socket.handshake?.auth?.adminToken !== undefined) return next();
            const st = await status();
            const full = getCount() >= st.maxSockets;
            if (st.mode === 'socket' && !full) return next();
            counters.refused += 1;
            const e = new Error(st.mode === 'off' ? 'TRACKING_OFF' : 'SERVER_BUSY');
            e.data = { mode: full && st.mode === 'socket' ? 'polling' : st.mode, pollSec: st.pollSec, retryAfterSec: st.retryAfterSec || 60 };
            return next(e);
        } catch (err) {
            return next();   // the guard failing must never block people
        }
    };
}

/* ------------------------------ the watchdog ------------------------------ */
function check() {
    const now = Date.now();
    if (lag.last) {
        const late = now - lag.last - 1000;   // the timer is set to fire every 1000 ms
        lag.max = Math.max(lag.max, late);
        lag.strikes = late > LAG_LIMIT_MS ? lag.strikes + 1 : 0;
    }
    lag.last = now;
    let heap = 0;
    try { const h = v8.getHeapStatistics(); heap = h.used_heap_size / h.heap_size_limit; } catch (e) { /* ignore */ }
    if ((lag.strikes >= 3 || heap > HEAP_LIMIT) && !autoOn()) {
        auto = { until: now + AUTO_MS, reason: lag.strikes >= 3 ? 'The server is busy' : 'The server memory is nearly full' };
        console.warn(`Live tracking: ${auto.reason}. Using polling for ${AUTO_MS / 60000} minutes.`);
        lag.strikes = 0;
    }
    notifyIfChanged();
}

async function notifyIfChanged() {
    try {
        const st = await status();
        if (st.mode !== lastMode) {
            lastMode = st.mode;
            if (typeof onChange === 'function') onChange(st);
        }
    } catch (e) { /* ignore */ }
}

function start(cb) {
    onChange = cb;
    if (timer) return;
    lag.last = Date.now();
    timer = setInterval(check, 1000);
    timer.unref?.();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

// the superadmin changed the setting: use it at once
function refresh() { settings.at = 0; return notifyIfChanged(); }
// tests and the admin screen
const forceAuto = (ms, reason = 'test') => { auto = { until: Date.now() + ms, reason }; return notifyIfChanged(); };
const clearAuto = () => { auto = { until: 0, reason: '' }; return notifyIfChanged(); };

function stats() {
    let heap = 0;
    try { const h = v8.getHeapStatistics(); heap = Math.round((h.used_heap_size / h.heap_size_limit) * 100); } catch (e) { /* ignore */ }
    return { ...counters, lagMaxMs: Math.round(lag.max), heapPercent: heap, autoUntil: autoOn() ? new Date(auto.until) : null };
}

module.exports = { DEFAULTS, config, status, middleware, start, stop, refresh, forceAuto, clearAuto, stats, counters };
