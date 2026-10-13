// Live updates (Socket.IO). One connection for the whole app, opened while a customer is logged in.
//   io(URL, { auth: { token: accessToken, tenant: 'shop-slug' } })
// The server sends:
//   'order:update'  { orderId, orderNo, status, kind }  an order we joined changed -> reload it
//   'notification'  { type, title, body, data }          a new inbox message for this customer
//   'auth:expired'  the token ended -> we reconnect with a fresh one
// Everything here is best effort: when the socket is down the screens keep their slow polling.
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/useAuthStore';
import { baseURL, tenantSlug, refreshSession } from './client';

const origin = baseURL.replace(/\/api\/?$/, '');
const AUTH_ERRORS = ['TOKEN_INVALID', 'SESSION_ENDED', 'AUTH_REQUIRED'];

let socket = null;
let retryTimer = null;
const joined = new Map();   // orderId -> how many screens want it
const listeners = { 'order:update': new Set(), notification: new Set() };

const emitJoin = (orderId) => {
    if (socket?.connected) socket.emit('order:join', { orderId }, () => { });
};

function dispatch(event, payload) {
    listeners[event].forEach((fn) => { try { fn(payload); } catch (e) { /* a screen bug must not stop the others */ } });
}

function disconnect() {
    clearTimeout(retryTimer);
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

    socket.on('connect', () => { joined.forEach((_, id) => emitJoin(id)); });
    socket.on('order:update', (p) => dispatch('order:update', p));
    socket.on('notification', (p) => dispatch('notification', p));

    // an ended token does not retry by itself: get a new one, then try again
    const renew = () => {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(async () => {
            try { await refreshSession(); } catch (e) { return; }
            if (socket && !socket.connected) socket.connect();
        }, 1500);
    };
    socket.on('connect_error', (err) => { if (AUTH_ERRORS.includes(err?.message)) renew(); });
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

export const realtimeConnected = () => !!socket?.connected;
