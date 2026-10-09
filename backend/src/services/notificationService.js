// Notifications. Every function here is safe: it never throws, so a notification problem can never break an order.
// Each message is saved in the inbox, sent live with Socket.IO, and sent as push (best effort).
const Notification = require('../models/Notification');
const DeviceToken = require('../models/DeviceToken');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const User = require('../models/User');
const push = require('./adapters/push');
const realtime = require('./realtime');

// phones of one person, or of every owner (role admin) of the shop
async function pushTo({ tenantId, userId, title, body, data }) {
    const userIds = userId
        ? [userId]
        : (await User.find({ tenantId, role: 'admin' }).select('_id').lean()).map((u) => u._id);
    if (!userIds.length) return;

    const rows = await DeviceToken.find({ tenantId, userId: { $in: userIds } }).select('token').lean();
    const tokens = rows.map((r) => r.token);
    if (!tokens.length) return;

    const res = await push.send({ tokens, title, body, data });
    if (res?.invalidTokens?.length) await DeviceToken.deleteMany({ token: { $in: res.invalidTokens } });
}

async function send({ tenantId, userId, role, type, title, body, data }) {
    try {
        if (!tenantId || (!userId && !role)) return null;
        const doc = await Notification.create({
            tenantId, userId, role, type,
            title: String(title).slice(0, 120),
            body: body ? String(body).slice(0, 300) : undefined,
            data,
        });

        const payload = { id: doc._id, type, title: doc.title, body: doc.body || null, data: data || null, createdAt: doc.createdAt };
        if (role === 'superadmin') return doc;   // platform inbox only: no live message or push to the shop
        if (userId) realtime.toUser(tenantId, userId, 'notification', payload);
        else realtime.toOwner(tenantId, 'notification', payload);

        pushTo({ tenantId, userId, title: doc.title, body: doc.body, data: { ...(data || {}), type } })
            .catch((e) => console.error('Push error:', e.message));
        return doc;
    } catch (e) {
        console.error('Notification error:', e.message);
        return null;
    }
}

const toOwner = (tenantId, p) => send({ tenantId, role: 'owner', ...p });
const toUser = (tenantId, userId, p) => send({ tenantId, userId, ...p });

// Tells the owner screens (and the order's own screen) that an order changed. The app then reloads that order.
// kind: status | rider
function pulse({ tenantId, orderId, orderNo, status, kind, toOrder = true }) {
    const p = { orderId: String(orderId), orderNo, status, kind };
    realtime.toOwner(tenantId, 'order:update', p);
    if (toOrder) realtime.toOrder(orderId, 'order:update', p);
}

const riderName = async (tenantId, userId) => {
    const r = await Rider.findOne({ tenantId, userId }).select('name').lean();
    return r?.name || 'Your delivery partner';
};

/* ------------------------------ orders ------------------------------ */
function orderPlaced(order) {
    try {
        toOwner(order.tenantId, {
            type: 'order_new',
            title: 'New order',
            body: `Order #${order.orderNo} - Rs ${order.pricing?.total ?? ''} - ${String(order.orderType).replace('_', '-')}`,
            data: { orderId: String(order._id), orderNo: order.orderNo },
        });
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: 'placed', kind: 'status', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function customerText(order, status) {
    const no = order.orderNo;
    switch (status) {
        case 'accepted': return { title: 'Order accepted', body: `The shop accepted your order #${no}.` };
        case 'preparing': return { title: 'Being prepared', body: `Your order #${no} is being prepared.` };
        case 'ready':
            return order.orderType === 'pickup'
                ? { title: 'Ready for pickup', body: `Your order #${no} is ready for pickup.` }
                : { title: 'Order ready', body: `Your order #${no} is ready.` };
        case 'out_for_delivery': return { title: 'On the way', body: `Your order #${no} is on the way.` };
        case 'delivered': return { title: 'Delivered', body: `Your order #${no} was delivered. Enjoy!` };
        case 'cancelled': return { title: 'Order cancelled', body: `Your order #${no} was cancelled.${order.cancelReason ? ` Reason: ${order.cancelReason}` : ''}` };
        default: return null;
    }
}

function orderStatusChanged(order, status, actor) {
    try {
        const t = order.tenantId;
        const no = order.orderNo;
        const data = { orderId: String(order._id), orderNo: no, status };

        // the customer is told about every step, except a cancel he made himself
        if (actor.type !== 'customer') {
            const m = customerText(order, status);
            if (m) toUser(t, order.userId, { type: 'order_status', ...m, data });
        }
        if (status === 'cancelled') {
            if (actor.type === 'customer' || actor.type === 'system') {
                toOwner(t, {
                    type: 'order_cancelled', title: 'Order cancelled', data,
                    body: `Order #${no} was cancelled${actor.type === 'system' ? ' (not accepted in time)' : ' by the customer'}.`,
                });
            }
            if (order.delivery?.riderId && actor.type !== 'rider') {
                toUser(t, order.delivery.riderId, { type: 'order_cancelled', title: 'Order cancelled', body: `Order #${no} was cancelled.`, data });
            }
        }
        pulse({ tenantId: t, orderId: order._id, orderNo: no, status, kind: 'status' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

/* ------------------------------ riders ------------------------------ */
function riderOffered(order) {
    try {
        const secs = Math.max(1, Math.round((new Date(order.delivery.offerExpiresAt).getTime() - Date.now()) / 1000));
        toUser(order.tenantId, order.delivery.riderId, {
            type: 'rider_offer', title: 'New delivery request',
            body: `Order #${order.orderNo}. Please accept within ${secs} seconds.`,
            data: { orderId: String(order._id), orderNo: order.orderNo },
        });
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: order.status, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function riderAccepted(order) {
    try {
        const name = await riderName(order.tenantId, order.delivery.riderId);
        const data = { orderId: String(order._id), orderNo: order.orderNo };
        toUser(order.tenantId, order.userId, {
            type: 'rider_assigned', title: 'Delivery partner assigned', body: `${name} will deliver your order #${order.orderNo}.`, data,
        });
        toOwner(order.tenantId, {
            type: 'rider_accepted', title: 'Rider accepted', body: `${name} accepted order #${order.orderNo}.`, data,
        });
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: order.status, kind: 'rider' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function riderRejected({ tenantId, orderId, riderUserId }) {
    try {
        const [o, name] = await Promise.all([
            Order.findOne({ _id: orderId, tenantId }).select('orderNo status').lean(),
            riderName(tenantId, riderUserId),
        ]);
        toOwner(tenantId, {
            type: 'rider_rejected', title: 'Rider said no',
            body: `${name} rejected order #${o?.orderNo ?? ''}.`,
            data: { orderId: String(orderId), orderNo: o?.orderNo },
        });
        pulse({ tenantId, orderId, orderNo: o?.orderNo, status: o?.status, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function noRiderFree({ tenantId, orderId, orderNo }) {
    try {
        toOwner(tenantId, {
            type: 'rider_none', title: 'No rider available',
            body: `Order #${orderNo} needs a rider. Please assign one by hand.`,
            data: { orderId: String(orderId), orderNo },
        });
        pulse({ tenantId, orderId, orderNo, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function riderRemoved({ tenantId, riderUserId, orderId, orderNo }) {
    try {
        realtime.leaveOrder({ tenantId, userId: riderUserId, orderId });   // he must stop hearing about this order
        toUser(tenantId, riderUserId, {
            type: 'rider_removed', title: 'Order taken back',
            body: `Order #${orderNo} was given to someone else.`,
            data: { orderId: String(orderId), orderNo },
        });
        pulse({ tenantId, orderId, orderNo, kind: 'rider' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}
async function riderProblem({ tenantId, orderId, orderNo, riderUserId, reason, note }) {
    try {
        const name = await riderName(tenantId, riderUserId);
        const text = {
            cannot_reach: 'cannot reach the customer',
            customer_not_answering: 'customer is not answering',
            wrong_address: 'says the address looks wrong',
            other: 'reported a problem',
        }[reason] || 'reported a problem';
        toOwner(tenantId, {
            type: 'rider_problem', title: 'Delivery problem',
            body: `${name} ${text} (order #${orderNo}).${note ? ` Note: ${note}` : ''}`,
            data: { orderId: String(orderId), orderNo, reason },
        });
        pulse({ tenantId, orderId, orderNo, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function lowDeliveryRating({ tenantId, orderId, orderNo, rating, riderUserId, comment }) {
    try {
        const name = await riderName(tenantId, riderUserId);
        toOwner(tenantId, {
            type: 'delivery_low_rating', title: 'Low delivery rating',
            body: `Order #${orderNo}: ${rating} star(s) for ${name}.${comment ? ` "${String(comment).slice(0, 100)}"` : ''}`,
            data: { orderId: String(orderId), orderNo, rating },
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

module.exports = {
    send, toOwner, toUser,
    orderPlaced, orderStatusChanged,
    riderOffered, riderAccepted, riderRejected, noRiderFree, riderRemoved, riderProblem, lowDeliveryRating
};