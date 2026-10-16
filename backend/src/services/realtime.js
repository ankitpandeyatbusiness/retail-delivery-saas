// Live updates with Socket.IO.
//
// The app connects with:  io(URL, { auth: { token: accessToken, tenant: 'shop-slug' } })
//
// Rooms:
//   user:<tenantId>:<userId>   one person (customer, rider or owner). Joined automatically.
//   tenant:<tenantId>          the owner side of one shop (users with role admin). Joined automatically.
//   order:<orderId>            one order. The app asks with  emit('order:join', { orderId }, ack)
//                              Allowed: the order's customer, its accepted rider, the shop's owners.
//
// The server sends:  'notification'  (a new inbox message)
//                    'order:update'  ({ orderId, orderNo, status, kind })  the app should reload that order
//                    'auth:expired'  (the token ended, connect again with a fresh token)
//                    'rider:location' ({ orderId, lat, lng, heading, speed, at, seq })  the rider moved (rooms order:<id>); also sent once when you join
//                    'tracking:mode' ({ mode, pollSec })  the server asks the apps to poll instead of using sockets (or to come back)
// A rider sends his position with  emit('rider:ping', { lat, lng, heading?, speed?, accuracy? }, ack)  (see services/liveTracking.js).
// A new connection can be refused with the error SERVER_BUSY / TRACKING_OFF and err.data { mode, pollSec, retryAfterSec }:
// the app then polls and tries the socket again later (services/trackingGuard.js).
//
// If the server runs on more than one machine, add the Redis adapter later (Phase 9).
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const tokenService = require('./tokenService');
const Session = require('../models/Session');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const SuperAdmin = require('../models/SuperAdmin');
const { verifyAdminToken } = require('./superAdminToken');
const Order = require('../models/Order');
const guard = require('./trackingGuard');

let io = null;

// who is connected right now (decides live message, push or SMS). Counts each connection. One server only.
const online = { users: new Map(), owners: new Map() };
const bump = (map, key, d) => {
    const n = (map.get(key) || 0) + d;
    if (n > 0) map.set(key, n); else map.delete(key);
};

const room = {
    tenant: (t) => `tenant:${t}`,
    user: (t, u) => `user:${t}:${u}`,
    order: (o) => `order:${o}`,
    adminAll: 'admin:all',                          // a superadmin sees every shop
    adminTenant: (t) => `admin:tenant:${t}`,        // or only one shop (after admin:watch)
};
const MAX_ORDER_ROOMS = 20;
const MAX_JOINS_PER_MIN = 30;

// A superadmin connects with auth { adminToken }. Shop tokens never work here, and the reverse.
async function authAdminSocket(socket, adminToken, next) {
    try {
        if (typeof adminToken !== 'string') return next(new Error('TOKEN_INVALID'));
        let decoded;
        try { decoded = verifyAdminToken(adminToken); } catch (e) { return next(new Error('TOKEN_INVALID')); }
        const admin = await SuperAdmin.findById(decoded.sub).select('_id isActive').lean();
        if (!admin || !admin.isActive) return next(new Error('FORBIDDEN'));
        socket.data = { isAdmin: true, adminId: String(admin._id), exp: decoded.exp };
        next();
    } catch (e) {
        console.error('Socket admin auth error:', e.message);
        next(new Error('SERVER_ERROR'));
    }
}

async function authSocket(socket, next) {
    try {
        const { token, tenant: slug, adminToken } = socket.handshake.auth || {};
        if (adminToken !== undefined) return authAdminSocket(socket, adminToken, next);
        if (typeof token !== 'string' || typeof slug !== 'string' || !slug.trim()) return next(new Error('AUTH_REQUIRED'));

        let decoded;
        try { decoded = tokenService.verifyAccessToken(token); } catch (e) { return next(new Error('TOKEN_INVALID')); }

        const tenant = await Tenant.findOne({ slug: slug.trim().toLowerCase() }).select('_id').lean();
        if (!tenant || String(decoded.tid) !== String(tenant._id)) return next(new Error('FORBIDDEN'));

        const alive = await Session.exists({ _id: decoded.sid, userId: decoded.sub, tenantId: tenant._id });
        if (!alive) return next(new Error('SESSION_ENDED'));

        // the role is read from the database, not from the token
        const user = await User.findOne({ _id: decoded.sub, tenantId: tenant._id }).select('role').lean();
        if (!user) return next(new Error('FORBIDDEN'));

        socket.data = { userId: String(decoded.sub), tenantId: String(tenant._id), role: user.role, exp: decoded.exp };
        next();
    } catch (e) {
        console.error('Socket auth error:', e.message);
        next(new Error('SERVER_ERROR'));
    }
}

function onAdminConnection(socket) {
    socket.join(room.adminAll);
    const { exp } = socket.data;
    if (exp) {
        const ms = exp * 1000 - Date.now();
        if (ms <= 0) { socket.disconnect(true); return; }
        const timer = setTimeout(() => { socket.emit('auth:expired'); socket.disconnect(true); }, Math.min(ms, 2 ** 31 - 1));
        timer.unref?.();
        socket.on('disconnect', () => clearTimeout(timer));
    }

    // watch ONE shop: leave the "all shops" room and join that shop's room. admin:unwatch goes back.
    let watching = null;
    socket.on('admin:watch', (payload, ack) => {
        const done = typeof ack === 'function' ? ack : () => { };
        const id = payload?.tenantId;
        if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) return done({ ok: false, error: 'Shop not found' });
        if (watching) socket.leave(room.adminTenant(watching));
        socket.leave(room.adminAll);
        socket.join(room.adminTenant(id));
        watching = id;
        done({ ok: true });
    });
    socket.on('admin:unwatch', (payload, ack) => {
        const done = typeof ack === 'function' ? ack : () => { };
        if (watching) socket.leave(room.adminTenant(watching));
        watching = null;
        socket.join(room.adminAll);
        done({ ok: true });
    });
}

function onConnection(socket) {
    if (socket.data.isAdmin) return onAdminConnection(socket);
    const { userId, tenantId, role, exp } = socket.data;
    socket.join(room.user(tenantId, userId));
    if (role === 'admin') socket.join(room.tenant(tenantId));

    // count this connection, and take it off again when he leaves
    bump(online.users, `${tenantId}:${userId}`, 1);
    if (role === 'admin') bump(online.owners, tenantId, 1);
    socket.on('disconnect', () => {
        bump(online.users, `${tenantId}:${userId}`, -1);
        if (role === 'admin') bump(online.owners, tenantId, -1);
    });

    // when the access token ends, tell the app and close. The app reconnects with a fresh token.
    if (exp) {
        const ms = exp * 1000 - Date.now();
        if (ms <= 0) { socket.disconnect(true); return; }
        const timer = setTimeout(() => { socket.emit('auth:expired'); socket.disconnect(true); }, Math.min(ms, 2 ** 31 - 1));
        timer.unref?.();
        socket.on('disconnect', () => clearTimeout(timer));
    }

    let joins = 0;
    let windowStart = Date.now();

    socket.on('order:join', async (payload, ack) => {
        const done = typeof ack === 'function' ? ack : () => { };
        try {
            if (Date.now() - windowStart > 60000) { windowStart = Date.now(); joins = 0; }
            if (++joins > MAX_JOINS_PER_MIN) return done({ ok: false, error: 'Too many requests' });

            const orderId = payload?.orderId;
            if (typeof orderId !== 'string' || !mongoose.isValidObjectId(orderId)) return done({ ok: false, error: 'Order not found' });
            const already = [...socket.rooms].filter((r) => r.startsWith('order:')).length;
            if (already >= MAX_ORDER_ROOMS) return done({ ok: false, error: 'Too many open orders' });

            const o = await Order.findOne({ _id: orderId, tenantId }).select('userId status delivery.riderId delivery.status').lean();
            if (!o) return done({ ok: false, error: 'Order not found' });

            const isOwner = role === 'admin';
            const isCustomer = String(o.userId) === userId;
            const isRider = String(o.delivery?.riderId) === userId && ['accepted', 'picked_up'].includes(o.delivery?.status);
            if (!isOwner && !isCustomer && !isRider) return done({ ok: false, error: 'Order not found' });

            socket.join(room.order(orderId));
            done({ ok: true });
            // the map should not wait for the next ping: send the last known position of the rider at once
            if (o.status === 'out_for_delivery' && o.delivery?.status === 'picked_up' && o.delivery?.riderId) {
                require('./liveTracking').sendSnapshot(socket, orderId, o.delivery.riderId);   // required here: liveTracking uses this file
                require('./tripEta').sendSnapshot(socket, orderId);                            // and the route + arrival time
            }
        } catch (e) {
            console.error('Socket join error:', e.message);
            done({ ok: false, error: 'Something went wrong' });
        }
    });

    // a rider's position over the socket. Same rules as the web request (services/liveTracking.js), plus a small limit per socket.
    if (role === 'rider') {
        let tokens = 20;
        let refilled = Date.now();
        socket.on('rider:ping', async (payload, ack) => {
            const done = typeof ack === 'function' ? ack : () => { };
            try {
                const now = Date.now();
                tokens = Math.min(20, tokens + (now - refilled) / 1500);
                refilled = now;
                if (tokens < 1) return done({ ok: true, saved: false, reason: 'too_fast' });
                tokens -= 1;
                done(await require('./liveTracking').ingest({ tenantId, riderId: userId, body: payload, via: 'socket', now }));
            } catch (e) {
                console.error('Socket ping error:', e.message);
                done({ ok: false, reason: 'Something went wrong' });
            }
        });
    }

    socket.on('order:leave', (payload) => {
        if (typeof payload?.orderId === 'string') socket.leave(room.order(payload.orderId));
    });
}

function init(httpServer) {
    if (io) return io;
    io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 10 * 1024 });
    io.use(guard.middleware(() => io.engine.clientsCount));   // refuses new sockets when the server is struggling or full
    io.use(authSocket);
    io.on('connection', onConnection);
    // when the mode changes, tell every connected app at once (they switch to polling, or come back)
    guard.start((st) => {
        try {
            io.emit('tracking:mode', { mode: st.mode, pollSec: st.pollSec, retryAfterSec: st.retryAfterSec || 0 });
            // calm the server: after a moment close the open sockets (never a superadmin's). The apps poll and come back later.
            if (st.mode !== 'socket') {
                const t = setTimeout(async () => {
                    try {
                        if ((await guard.status()).mode === 'socket') return;   // it recovered in the meantime
                        for (const s of io.sockets.sockets.values()) if (!s.data?.isAdmin) { s.disconnect(true); guard.counters.shed += 1; }
                    } catch (e) { /* ignore */ }
                }, guard.config.shedDelayMs);
                t.unref?.();
            }
        } catch (e) { /* ignore */ }
    });
    console.log('Realtime (Socket.IO) is on');
    return io;
}

/* ------------------------------ sending (all safe: if realtime is off, nothing happens) ------------------------------ */
function emit(to, event, payload) {
    try {
        if (io) io.to(to).emit(event, payload);
    } catch (e) {
        console.error('Realtime emit error:', e.message);
    }
}

const toUser = (tenantId, userId, event, payload) => emit(room.user(tenantId, userId), event, payload);
const toOwner = (tenantId, event, payload) => emit(room.tenant(tenantId), event, payload);
const toOrder = (orderId, event, payload) => emit(room.order(orderId), event, payload);
// to every superadmin who watches all shops, and to those who watch this one shop
const toAdmin = (tenantId, event, payload) => {
    try {
        if (io) io.to([room.adminAll, room.adminTenant(tenantId)]).emit(event, payload);
    } catch (e) {
        console.error('Realtime admin emit error:', e.message);
    }
};

// a rider who lost an order must stop hearing about it
function leaveOrder({ tenantId, userId, orderId }) {
    try {
        if (io) io.in(room.user(tenantId, userId)).socketsLeave(room.order(orderId));
    } catch (e) {
        console.error('Realtime leave error:', e.message);
    }
}

const connectionCount = () => (io ? io.engine.clientsCount : 0);
const isUserOnline = (tenantId, userId) => online.users.has(`${tenantId}:${userId}`);
const isOwnerOnline = (tenantId) => online.owners.has(String(tenantId));

module.exports = { init, connectionCount, toUser, toOwner, toOrder, toAdmin, leaveOrder, isUserOnline, isOwnerOnline };