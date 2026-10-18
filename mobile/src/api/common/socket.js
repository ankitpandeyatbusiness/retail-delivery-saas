// Live updates (Socket.IO). One connection for the whole app, opened while a customer is logged in.
//   io(URL, { auth: { token: accessToken, tenant: 'shop-slug' } })
// The server sends:
//   'order:update'  { orderId, orderNo, status, kind }  an order we joined changed -> reload it
//   'notification'  { type, title, body, data }          a new inbox message for this customer
//   'rider:location' { orderId, lat, lng, at }           the rider moved (only for an order that is on the way and that we joined)
//   'auth:expired'  the token ended -> we reconnect with a fresh one
// Everything here is best effort: when the socket is down the screens keep their slow polling.
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useAuthStore } from '../../store/common/useAuthStore';
import { baseURL, tenantSlug, refreshSession } from './client';

const origin = baseURL.replace(/\/api\/?$/, '');
const AUTH_ERRORS = ['TOKEN_INVALID', 'SESSION_ENDED', 'AUTH_REQUIRED'];

let socket = null;
let retryTimer = null;
const joined = new Map();   // orderId -> how many screens want it
const listeners = { 'order:update': new Set(), notification: new Set(), 'rider:location': new Set(), 'rider:route': new Set(), 'order:eta': new Set(), 'rider:quiet': new Set(), 'rider:offer': new Set(), 'offer:closed': new Set() };

// What the server asks of us: "socket" (normal) or "polling" (it is busy: poll every pollSec seconds and try the socket again
// later). Screens read this to decide whether they need a timer. We never retry a refused connection sooner than retryAfterSec.
let trackingMode = { mode: 'socket', pollSec: 15, retryAfterSec: 0 };
const modeListeners = new Set();
let comeBackTimer = null;
const setMode = (m) => {
    trackingMode = { ...trackingMode, ...m };
    modeListeners.forEach((fn) => { try { fn(trackingMode); } catch (e) { /* a screen bug must not stop the others */ } });
};
export const getTrackingMode = () => trackingMode;
export function onTrackingMode(fn) {
    modeListeners.add(fn);
    return () => modeListeners.delete(fn);
}
// try the socket again after the wait the server gave (plus a random extra, so phones do not all return at the same second)
function comeBackLater(seconds) {
    clearTimeout(comeBackTimer);
    const wait = (Math.max(30, seconds || 90) + Math.random() * 30) * 1000;
    comeBackTimer = setTimeout(() => {
        if (!socket || socket.connected) return;
        socket.io.opts.reconnection = true;
        socket.connect();
    }, wait);
}

const emitJoin = (orderId) => {
    if (socket?.connected) socket.emit('order:join', { orderId }, () => { });
};

function dispatch(event, payload) {
    listeners[event].forEach((fn) => { try { fn(payload); } catch (e) { /* a screen bug must not stop the others */ } });
}

function disconnect() {
    clearTimeout(retryTimer);
    clearTimeout(comeBackTimer);
    if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

// the token is read again on every (re)connect, so a refreshed token is picked up automatically
function connect() {
    if (socket || !useAuthStore.getState().accessToken) return;
    socket = io(origin, {
        transports: ['websocket'],
        auth: (cb) => cb({ token: useAuthStore.getState().accessToken, tenant: tenantSlug }),
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 20000,
    });

    socket.on('connect', () => { setMode({ mode: 'socket', retryAfterSec: 0 }); joined.forEach((_, id) => emitJoin(id)); });
    // the server is busy or tracking is off: poll, and do not keep knocking
    socket.on('tracking:mode', (p) => {
        setMode({ mode: p?.mode || 'socket', pollSec: p?.pollSec || 15, retryAfterSec: p?.retryAfterSec || 0 });
        if (p?.mode && p.mode !== 'socket') { socket.io.opts.reconnection = false; comeBackLater(p.retryAfterSec); }
    });
    socket.on('disconnect', (reason) => {
        // closed by the server while it is in polling mode: do not reconnect at once
        if (reason === 'io server disconnect' && trackingMode.mode !== 'socket') comeBackLater(trackingMode.retryAfterSec);
    });
    socket.on('order:update', (p) => dispatch('order:update', p));
    socket.on('notification', (p) => dispatch('notification', p));
    socket.on('rider:location', (p) => dispatch('rider:location', p));
    socket.on('rider:route', (p) => dispatch('rider:route', p));
    socket.on('order:eta', (p) => dispatch('order:eta', p));
    socket.on('rider:quiet', (p) => dispatch('rider:quiet', p));
    socket.on('rider:offer', (p) => dispatch('rider:offer', p));      // a rider is asked to take an order
    socket.on('offer:closed', (p) => dispatch('offer:closed', p));    // someone else took it, or it closed

    // an ended token does not retry by itself: get a new one, then try again
    const renew = () => {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(async () => {
            try { await refreshSession(); } catch (e) { return; }
            if (socket && !socket.connected) socket.connect();
        }, 1500);
    };
    socket.on('connect_error', (err) => {
        if (AUTH_ERRORS.includes(err?.message)) { renew(); return; }
        if (err?.message === 'SERVER_BUSY' || err?.message === 'TRACKING_OFF') {
            setMode({ mode: err.data?.mode || 'polling', pollSec: err.data?.pollSec || 15, retryAfterSec: err.data?.retryAfterSec || 90 });
            socket.io.opts.reconnection = false;
            socket.disconnect();
            comeBackLater(err.data?.retryAfterSec);
        }
    });
    socket.on('auth:expired', renew);
}

// Call once at start-up: follows login and logout, and reconnects when the app comes back to the front.
let started = false;
export function startRealtime() {
    if (started) return;
    started = true;

    const sync = () => (useAuthStore.getState().user ? connect() : disconnect());
    useAuthStore.subscribe((st, prev) => {
        if (st.user !== prev.user || st.accessToken !== prev.accessToken) sync();
    });
    AppState.addEventListener('change', (s) => {
        if (s === 'active' && useAuthStore.getState().user && socket && !socket.connected) socket.connect();
    });
    sync();
}

// Returns a function that stops listening.
export function onOrderUpdate(fn) {
    listeners['order:update'].add(fn);
    return () => listeners['order:update'].delete(fn);
}

// The rider's position, pushed as he moves. Join the order first (watchOrder).
export function onRiderLocation(fn) {
    listeners['rider:location'].add(fn);
    return () => listeners['rider:location'].delete(fn);
}

// The road line, the arrival time and "his phone went quiet" for an order we joined (Phase 2 events).
const sub = (ev) => (fn) => { listeners[ev].add(fn); return () => listeners[ev].delete(fn); };
export const onRiderRoute = sub('rider:route');
export const onOrderEta = sub('order:eta');
export const onRiderQuiet = sub('rider:quiet');
export const onRiderOffer = sub('rider:offer');
export const onOfferClosed = sub('offer:closed');

export function onNotification(fn) {
    listeners.notification.add(fn);
    return () => listeners.notification.delete(fn);
}

// Joins the room of one order (needed to hear its updates). Returns a function that leaves it.
export function watchOrder(orderId) {
    if (!orderId) return () => { };
    joined.set(orderId, (joined.get(orderId) || 0) + 1);
    emitJoin(orderId);
    return () => {
        const n = (joined.get(orderId) || 1) - 1;
        if (n > 0) { joined.set(orderId, n); return; }
        joined.delete(orderId);
        if (socket?.connected) socket.emit('order:leave', { orderId });
    };
}

// The rider's phone sends its position over the socket. Resolves with the server's answer, or null when the socket is not
// connected (or the server is slow): the caller then uses the web request instead.
export function sendRiderPing(payload) {
    return new Promise((resolve) => {
        if (!socket?.connected) { resolve(null); return; }
        const t = setTimeout(() => resolve(null), 4000);
        socket.emit('rider:ping', payload, (ack) => { clearTimeout(t); resolve(ack || null); });
    });
}

export const realtimeConnected = () => !!socket?.connected;
