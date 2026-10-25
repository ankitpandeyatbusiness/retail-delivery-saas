// Notifications. The rest of the code keeps calling these names; the real work (inbox, live, push, SMS)
// is in src/notifications/center.js and the wording is in src/notifications/templates/texts.js.
// Every function here is safe: it never throws, so a notification problem can never break an order.
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const realtime = require('./realtime');
const center = require('../notifications/center');
const liveFeed = require('./liveFeed');
const { isUnpaidOnline } = require('./onlineOrder');
const { orderSpeech, orderSpeechHi, cancelSpeech, cancelSpeechHi } = require('../utils/orderSpeech');
const { brief, payWord } = require('../utils/orderBrief');
const look = require('./orderLook');

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
function orderPlaced(order, opts = {}) {
    try {
        const auto = !!opts.autoAccepted;   // the shop accepts it by itself: the owner is told, with that on it
        center.notify('order_new', {
            tenantId: order.tenantId,
            vars: { orderNo: order.orderNo, total: order.pricing?.total, orderType: order.orderType, brief: brief(order, 3), pay: payWord(order), auto, tableNo: order.tableNo },
            // speech: the sentence the owner's phone reads out loud in Soundbox mode (see utils/orderSpeech.js)
            data: {
                orderId: String(order._id), orderNo: order.orderNo, total: order.pricing?.total,
                speech: orderSpeech(order) + (auto ? ' Auto accepted.' : ''), speechHi: orderSpeechHi(order) + (auto ? ' अपने आप स्वीकार हुआ।' : ''), itemCount: order.items?.length || 0,
                ...(auto ? { autoAccepted: true } : {}),
            },
        });
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: 'placed', kind: 'status', toOrder: false });
        liveFeed.emit(order.tenantId, 'orders', {
            type: 'order.placed', orderId: String(order._id), orderNo: order.orderNo,
            total: order.pricing?.total, orderType: order.orderType,
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function orderStatusChanged(order, status, actor) {
    try {
        const t = order.tenantId;
        const no = order.orderNo;
        const data = { orderId: String(order._id), orderNo: no, status };
        const what = { brief: brief(order), total: order.pricing?.total, tableNo: order.tableNo, orderType: order.orderType, ...(order.orderType === 'pickup' ? { pickupCode: (() => { try { return require('./deliveryPinService').pinFor(order); } catch (e) { return null; } })() } : {}) };   // what the order is, for the words of the message

        // the customer is told about every step, except a cancel he made himself
        if (actor.type !== 'customer') {
            center.notify('order_status', {
                tenantId: t, userId: order.userId, data,
                vars: {
                    orderNo: no, status, orderType: order.orderType, cancelReason: order.cancelReason, ...what,
                    reasonCode: order.undelivered?.reasonCode,
                },
            });
        }
        if (status === 'delivered') {
            if (actor.type !== 'owner') center.notify('order_delivered_shop', { tenantId: t, data, vars: { orderNo: no, ...what } });   // the shop already knows when it marked it itself
            if (order.delivery?.riderId) center.notify('delivery_done_rider', { tenantId: t, userId: order.delivery.riderId, data, vars: { orderNo: no, brief: what.brief } });
        }
        if (status === 'cancelled') {
            // the sentence the owner's phone may read out (Soundbox) when the app is closed: only for a cancelled order
            // said with the full detail of a new order: who cancelled it, the dishes, the total and how it was paid
            const spoken = (who) => ({ ...data, speech: cancelSpeech(order, who), speechHi: cancelSpeechHi(order, who) });
            // the owner has to look at it once (Orders tab: "Needs a look")
            if (actor.type === 'rider') look.byId(t, order._id, 'rider_cancelled');
            else if (!isUnpaidOnline(order)) {
                if (actor.type === 'system') look.byId(t, order._id, /hour late/.test(order.cancelReason || '') ? 'late_cancelled' : 'not_accepted');
                else if (actor.type === 'customer') look.byId(t, order._id, 'customer_cancelled');   // whether or not the shop had accepted it yet
            }
            if ((actor.type === 'customer' || actor.type === 'system') && !isUnpaidOnline(order)) {   // the owner never saw an unpaid online order
                center.notify('order_cancelled', {
                    tenantId: t, data: spoken(actor.type === 'system' ? (/hour late/.test(order.cancelReason || '') ? 'late' : 'system') : 'customer'), vars: { audience: 'owner', orderNo: no, bySystem: actor.type === 'system', lateDelivery: /hour late/.test(order.cancelReason || '') },
                });
            }
            if (actor.type === 'rider') {   // the delivery partner cancelled: the shop is told at once, with his reason
                center.notify('order_cancelled', {
                    tenantId: t, data: { ...spoken('rider'), byRider: true }, vars: { audience: 'owner', orderNo: no, byRider: true, reason: order.cancelReason },
                });
            }
            if (order.delivery?.riderId && actor.type !== 'rider') {
                center.notify('order_cancelled', {
                    tenantId: t, userId: order.delivery.riderId, data, vars: { audience: 'rider', orderNo: no, lateDelivery: /hour late/.test(order.cancelReason || '') },
                });
            }
        }
        if (status === 'undelivered' && actor.type !== 'owner') look.byId(t, order._id, 'undelivered');
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
            vars: {
                orderNo: order.orderNo, secs, brief: brief(order, 2), items: order.items?.length || 0,
                area: [order.address?.landmark, order.address?.city].filter(Boolean).join(', ').slice(0, 40),
                collect: order.payment?.method === 'cod' ? Math.round(Number(order.pricing?.total) || 0) : 0,
                note: String(order.note || '').slice(0, 80),
            },
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
        liveFeed.emit(order.tenantId, 'riders', {
            type: 'rider.accepted', orderNo: order.orderNo, riderId: String(order.delivery.riderId), riderName: name,
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
        center.notify('rider_rejected', {
            tenantId, vars: { riderName: name, orderNo: o?.orderNo },
            data: { orderId: String(orderId), orderNo: o?.orderNo },
        });
        pulse({ tenantId, orderId, orderNo: o?.orderNo, status: o?.status, kind: 'rider', toOrder: false });
        liveFeed.emit(tenantId, 'riders', { type: 'rider.rejected', orderNo: o?.orderNo, riderId: String(riderUserId), riderName: name });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function noRiderFree({ tenantId, orderId, orderNo }) {
    try {
        look.byId(tenantId, orderId, 'no_rider');
        center.notify('rider_none', { tenantId, vars: { orderNo }, data: { orderId: String(orderId), orderNo } });
        liveFeed.emit(tenantId, 'riders', { type: 'rider.none', orderNo });
        pulse({ tenantId, orderId, orderNo, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

function riderRemoved({ tenantId, riderUserId, orderId, orderNo }) {
    try {
        realtime.leaveOrder({ tenantId, userId: riderUserId, orderId });   // he must stop hearing about this order
        liveFeed.emit(tenantId, 'riders', { type: 'rider.removed', orderNo, riderId: String(riderUserId) });
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
        look.byId(tenantId, orderId, 'rider_problem');
        const name = await riderName(tenantId, riderUserId);
        liveFeed.emit(tenantId, 'riders', { type: 'rider.problem', orderNo, riderId: String(riderUserId), riderName: name, reason });
        center.notify('rider_problem', {
            tenantId, vars: { riderName: name, orderNo, reason, note },
            data: { orderId: String(orderId), orderNo, reason },
        });
        pulse({ tenantId, orderId, orderNo, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// the rider pressed the help button: the owner is told with his name, phone, order and last position
async function riderSos({ tenantId, riderUserId, phone, orderNo, spot }) {
    try {
        look.byNo(tenantId, orderNo, 'rider_sos');
        const name = await riderName(tenantId, riderUserId);
        liveFeed.emit(tenantId, 'riders', { type: 'rider.sos', orderNo: orderNo || null, riderId: String(riderUserId), riderName: name });
        center.notify('rider_sos', {
            tenantId, vars: { riderName: name, phone, orderNo },
            data: {
                kind: 'sos', riderId: String(riderUserId), phone, orderNo: orderNo || null, ...(spot ? { lat: spot.lat, lng: spot.lng } : {}),
                speech: `${name} needs help${orderNo ? `. Order ${orderNo}` : ''}. Please call now.`, speechHi: `${name} को मदद चाहिए${orderNo ? `। ऑर्डर ${orderNo}` : ''}। अभी फ़ोन करें।`,   // read out by the owner's phone
            },
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function lowDeliveryRating({ tenantId, orderId, orderNo, rating, riderUserId, comment }) {
    try {
        const name = await riderName(tenantId, riderUserId);
        liveFeed.emit(tenantId, 'riders', { type: 'rider.low_rating', orderNo, riderId: String(riderUserId), rating });
        center.notify('delivery_low_rating', {
            tenantId, vars: { riderName: name, orderNo, rating, comment },
            data: { orderId: String(orderId), orderNo, rating },
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// A customer reviewed the FOOD of a delivered order: the shop is told, whatever the stars. (Never the rider.)
function foodReviewed({ tenantId, orderId, orderNo, ratings, nameOf }) {
    try {
        const stars = ratings.map((r) => r.rating);
        const avg = Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10;
        const first = ratings.find((r) => typeof r.comment === 'string' && r.comment.trim());
        const dish = ratings.length === 1 ? ` for ${nameOf[ratings[0].productId] || 'a dish'}` : ` for ${ratings.length} dishes`;
        center.notify('review_food', {
            tenantId, title: 'New food review',
            body: `Order #${orderNo}: ${avg} star${avg === 1 ? '' : 's'}${dish}.${first ? ` "${first.comment.trim().slice(0, 100)}"` : ''}`,
            data: { orderId: String(orderId), orderNo, rating: avg },
        });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// A customer reviewed the DELIVERY: the rider who delivered it and the shop are both told.
function deliveryReviewed({ tenantId, orderId, orderNo, rating, riderUserId, comment, toOwner = true }) {
    try {
        const note = typeof comment === 'string' && comment.trim() ? ` "${comment.trim().slice(0, 100)}"` : '';
        const data = { orderId: String(orderId), orderNo, rating };
        if (toOwner) {
            center.notify('review_delivery', { tenantId, title: 'New delivery review', body: `Order #${orderNo}: ${rating} star${rating === 1 ? '' : 's'} for the delivery.${note}`, data });
        }
        if (riderUserId) {
            center.notify('review_delivery_rider', { tenantId, userId: riderUserId, title: 'You got a review', body: `The customer of order #${orderNo} gave your delivery ${rating} star${rating === 1 ? '' : 's'}.${note}`, data });
        }
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

/* ------------------------------ rider broadcast: all free riders at once ------------------------------ */
// What a rider may see BEFORE he accepts: no customer name, phone or full address.
function offerCard(order) {
    const d = order.delivery || {};
    const cod = order.payment?.method === 'cod' && order.payment?.status !== 'paid';
    return {
        orderId: String(order._id),
        orderNo: order.orderNo,
        expiresAt: d.broadcast?.expiresAt || null,
        items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
        address: { city: order.address?.city, pincode: order.address?.pincode, landmark: order.address?.landmark },
        payment: { method: order.payment?.method, collectAmount: cod ? order.pricing?.total : 0 },
    };
}

// live card (event "rider:offer") + inbox message + push, for each rider
function riderBroadcast(order, riderIds) {
    try {
        const secs = Math.max(1, Math.round((new Date(order.delivery.broadcast.expiresAt).getTime() - Date.now()) / 1000));
        const card = offerCard(order);
        liveFeed.emit(order.tenantId, 'riders', { type: 'rider.offered', orderNo: order.orderNo, riders: riderIds.length });
        const count = (order.items || []).reduce((n, i) => n + (i.quantity || 0), 0);
        const collect = card.payment.collectAmount > 0 ? card.payment.collectAmount : null;
        for (const riderId of riderIds) {
            realtime.toUser(order.tenantId, riderId, 'rider:offer', card);
            center.notify('rider_offer', {
                tenantId: order.tenantId, userId: riderId,
                vars: {
                    orderNo: order.orderNo, secs, items: count, collect, brief: brief(order, 2),
                    area: [order.address?.landmark, order.address?.city].filter(Boolean).join(', ').slice(0, 40),   // no name, phone or full address before accepting
                },
                data: { orderId: String(order._id), orderNo: order.orderNo, broadcast: true },
            });
        }
        pulse({ tenantId: order.tenantId, orderId: order._id, orderNo: order.orderNo, status: order.status, kind: 'rider', toOrder: false });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// live event "offer:closed" to the riders who were asked: another rider was faster (why = taken), or the request closed
function offersClosed({ tenantId, orderId, orderNo, why, riderIds = [] }) {
    try {
        const message = why === 'taken' ? 'Taken by someone else' : 'This request is closed';
        for (const riderId of riderIds) {
            realtime.toUser(tenantId, riderId, 'offer:closed', { orderId: String(orderId), orderNo, why, message });
        }
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// The rider tapped "I have arrived": the customer is told at once (once per order: the live tracking may already have said it)
// and so is the shop.
async function riderArrived(order) {
    try {
        const name = await riderName(order.tenantId, order.delivery?.riderId);
        const first = await Order.updateOne({ _id: order._id, tenantId: order.tenantId, 'delivery.reachedNotifiedAt': { $exists: false } }, { $set: { 'delivery.reachedNotifiedAt': new Date() } });
        const data = { orderId: String(order._id), orderNo: order.orderNo };
        if (first.modifiedCount) {
            center.notify('rider_reached', {
                tenantId: order.tenantId, userId: order.userId,
                title: `${name} has reached`, body: `Order #${order.orderNo}: your delivery partner is at your address now. Please keep your delivery PIN ready.`,
                data: { ...data, kind: 'tracking' },
            });
        }
        center.notify('rider_arrived_shop', { tenantId: order.tenantId, vars: { riderName: name, orderNo: order.orderNo }, data });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

module.exports = {
    send, toOwner, toUser, riderArrived,
    orderPlaced, orderStatusChanged,
    riderOffered, riderAccepted, riderRejected, noRiderFree, riderRemoved, riderProblem, riderSos, lowDeliveryRating, foodReviewed, deliveryReviewed,
    riderBroadcast, offersClosed,
};