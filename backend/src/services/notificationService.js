// Notifications. The rest of the code keeps calling these names; the real work (inbox, live, push, SMS)
// is in src/notifications/center.js and the wording is in src/notifications/templates/texts.js.
// Every function here is safe: it never throws, so a notification problem can never break an order.
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const realtime = require('./realtime');
const center = require('../notifications/center');

// old style helpers, still used by billing, the superadmin messages and the stuck-order watcher
const send = (p) => center.notify(p.type, { ...p, to: p.role === 'superadmin' ? 'superadmin' : undefined });
const toOwner = (tenantId, p) => center.notify(p.type, { ...p, tenantId });
const toUser = (tenantId, userId, p) => center.notify(p.type, { ...p, tenantId, userId });

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
        center.notify('order_new', {
            tenantId: order.tenantId,
            vars: { orderNo: order.orderNo, total: order.pricing?.total, orderType: order.orderType },
            data: { orderId: String(order._id), orderNo: order.orderNo, total: order.pricing?.total },
        });
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: 'placed', kind: 'status', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function orderStatusChanged(order, status, actor) {
    try {
        const t = order.tenantId;
        const no = order.orderNo;
        const data = { orderId: String(order._id), orderNo: no, status };

        // the customer is told about every step, except a cancel he made himself
        if (actor.type !== 'customer') {
            center.notify('order_status', {
                tenantId: t, userId: order.userId, data,
                vars: {
                    orderNo: no, status, orderType: order.orderType, cancelReason: order.cancelReason,
                    reasonCode: order.undelivered?.reasonCode,
                },
            });
        }
        if (status === 'cancelled') {
            if (actor.type === 'customer' || actor.type === 'system') {
                center.notify('order_cancelled', {
                    tenantId: t, data, vars: { audience: 'owner', orderNo: no, bySystem: actor.type === 'system' },
                });
            }
            if (order.delivery?.riderId && actor.type !== 'rider') {
                center.notify('order_cancelled', {
                    tenantId: t, userId: order.delivery.riderId, data, vars: { audience: 'rider', orderNo: no },
                });
            }
        }
        if (status === 'undelivered' && order.delivery?.riderId && actor.type !== 'rider') {
            center.notify('order_cancelled', {
                tenantId: t, userId: order.delivery.riderId, data, vars: { audience: 'rider', orderNo: no, undelivered: true },
            });
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
        center.notify('rider_offer', {
            tenantId: order.tenantId, userId: order.delivery.riderId,
            vars: { orderNo: order.orderNo, secs },
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
        center.notify('rider_assigned', { tenantId: order.tenantId, userId: order.userId, vars: { riderName: name, orderNo: order.orderNo }, data });
        center.notify('rider_accepted', { tenantId: order.tenantId, vars: { riderName: name, orderNo: order.orderNo }, data });
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
        center.notify('rider_rejected', {
            tenantId, vars: { riderName: name, orderNo: o?.orderNo },
            data: { orderId: String(orderId), orderNo: o?.orderNo },
        });
        pulse({ tenantId, orderId, orderNo: o?.orderNo, status: o?.status, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function noRiderFree({ tenantId, orderId, orderNo }) {
    try {
        center.notify('rider_none', { tenantId, vars: { orderNo }, data: { orderId: String(orderId), orderNo } });
        pulse({ tenantId, orderId, orderNo, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function riderRemoved({ tenantId, riderUserId, orderId, orderNo }) {
    try {
        realtime.leaveOrder({ tenantId, userId: riderUserId, orderId });   // he must stop hearing about this order
        center.notify('rider_removed', {
            tenantId, userId: riderUserId, vars: { orderNo }, data: { orderId: String(orderId), orderNo },
        });
        pulse({ tenantId, orderId, orderNo, kind: 'rider' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function riderProblem({ tenantId, orderId, orderNo, riderUserId, reason, note }) {
    try {
        const name = await riderName(tenantId, riderUserId);
        center.notify('rider_problem', {
            tenantId, vars: { riderName: name, orderNo, reason, note },
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
        center.notify('delivery_low_rating', {
            tenantId, vars: { riderName: name, orderNo, rating, comment },
            data: { orderId: String(orderId), orderNo, rating },
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

module.exports = {
    send, toOwner, toUser,
    orderPlaced, orderStatusChanged,
    riderOffered, riderAccepted, riderRejected, noRiderFree, riderRemoved, riderProblem, lowDeliveryRating,
};