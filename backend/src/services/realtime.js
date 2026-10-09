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
//
// If the server runs on more than one machine, add the Redis adapter later (Phase 9).
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const tokenService = require('./tokenService');
const Session = require('../models/Session');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Order = require('../models/Order');

let io = null;

const room = {
    tenant: (t) => `tenant:${t}`,
    user: (t, u) => `user:${t}:${u}`,
    order: (o) => `order:${o}`,
};
const MAX_ORDER_ROOMS = 20;
const MAX_JOINS_PER_MIN = 30;

async function authSocket(socket, next) {
    try {
        const { token, tenant: slug } = socket.handshake.auth || {};
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

function onConnection(socket) {
    const { userId, tenantId, role, exp } = socket.data;
    socket.join(room.user(tenantId, userId));
    if (role === 'admin') socket.join(room.tenant(tenantId));

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

            const o = await Order.findOne({ _id: orderId, tenantId }).select('userId delivery.riderId delivery.status').lean();
            if (!o) return done({ ok: false, error: 'Order not found' });

            const isOwner = role === 'admin';
            const isCustomer = String(o.userId) === userId;
            const isRider = String(o.delivery?.riderId) === userId && ['accepted', 'picked_up'].includes(o.delivery?.status);
            if (!isOwner && !isCustomer && !isRider) return done({ ok: false, error: 'Order not found' });

            socket.join(room.order(orderId));
            done({ ok: true });
        } catch (e) {
            console.error('Socket join error:', e.message);
            done({ ok: false, error: 'Something went wrong' });
        }
    });

    socket.on('order:leave', (payload) => {
        if (typeof payload?.orderId === 'string') socket.leave(room.order(payload.orderId));
    });
}

function init(httpServer) {
    if (io) return io;
    io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 10 * 1024 });
    io.use(authSocket);
    io.on('connection', onConnection);
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

// a rider who lost an order must stop hearing about it
function leaveOrder({ tenantId, userId, orderId }) {
    try {
        if (io) io.in(room.user(tenantId, userId)).socketsLeave(room.order(orderId));
    } catch (e) {
        console.error('Realtime leave error:', e.message);
    }
}

module.exports = { init, toUser, toOwner, toOrder, leaveOrder };