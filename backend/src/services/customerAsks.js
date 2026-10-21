// What a customer SAYS to the shop about an order, and the owner's answer (always with a polite message back):
//   pickup, at his pickup time   "I collected it"  -> the owner confirms, and (cash) says whether he paid. Not paid: it becomes a bill he owes
//                                                     (same reminders, same block on new orders as an unpaid table bill)
//                                "I do not want it" -> the owner chooses the refund: Full, Half, a quarter or none
//                                "Not yet"          -> asked again in 15 minutes
//   table, a round already being made   "please cancel it" -> the owner says yes (cancelled, no charge) or no
// An unpaid pickup is kept as a TableSession of kind 'pickup', so the whole unpaid-bill machinery (tableBill.js) works for it unchanged.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const { HIDE_UNPAID } = require('./onlineOrder');
const { brief } = require('../utils/orderBrief');
const { toPaise } = require('./refundService');
const apiErrors = require('../middlewares/apiErrors');

const { httpError } = apiErrors;
const SNOOZE_MS = 15 * 60000;
const PICKUP_OPEN = ['ready'];
const TABLE_OPEN = ['placed', 'accepted', 'preparing', 'ready'];
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notify error:', e.message));
const cashDue = (o) => (!o.payment?.method || o.payment.method === 'cod') && o.payment?.status !== 'paid';
const msgOf = (m) => String(m || '').trim().slice(0, 200);

/* ------------------------------ pickup: the customer is asked ------------------------------ */
async function pickupDue({ tenant, userId, now = new Date() }) {
    const rows = await Order.find({
        tenantId: tenant._id, userId, orderType: 'pickup', status: { $in: PICKUP_OPEN }, scheduledFor: { $lte: now },
        'pickupClaim.kind': { $exists: false },
        $or: [{ 'pickupClaim.snoozeUntil': { $exists: false } }, { 'pickupClaim.snoozeUntil': { $lte: now } }],
        ...HIDE_UNPAID,
    }).sort({ scheduledFor: 1 }).limit(5).lean();
    const view = (o, mode) => ({
        id: String(o._id), orderNo: o.orderNo, mode, summary: brief(o, 3), total: o.pricing?.total || 0,
        cash: cashDue(o), paid: o.payment?.status === 'paid', until: o.pickupUntil || null, scheduledFor: o.scheduledFor || null,
        early: !!o.scheduledFor && new Date(o.scheduledFor).getTime() - now.getTime() > 5 * 60000,   // the food is ready before the time he chose
        items: (o.items || []).map((l) => ({ name: l.name, quantity: l.quantity })),
    });
    // the food is ready and he has not told the shop anything yet: "Ready! Are you coming?"
    const ready = await Order.find({
        tenantId: tenant._id, userId, orderType: 'pickup', status: 'ready',
        'pickupClaim.kind': { $exists: false }, 'pickupIntent.kind': { $exists: false },
        ...HIDE_UNPAID,
    }).sort({ updatedAt: 1 }).limit(5).lean();
    const dueIds = new Set(rows.map((o) => String(o._id)));
    return [...rows.map((o) => view(o, 'due')), ...ready.filter((o) => !dueIds.has(String(o._id))).map((o) => view(o, 'ready'))];
}

const REPEAT_MS = 3 * 60000;   // he can tell the shop the same thing again after this long

async function pickupAnswer({ tenant, userId, orderId, answer }) {
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId, orderType: 'pickup' });
    if (!order) throw httpError(404, 'Order not found');
    if (!PICKUP_OPEN.includes(order.status)) throw httpError(409, 'This order is no longer waiting');
    if (order.pickupClaim?.kind) return { ok: true, already: true };
    if (answer === 'later') {
        await Order.updateOne({ _id: order._id }, { $set: { 'pickupClaim.snoozeUntil': new Date(Date.now() + SNOOZE_MS) } });
        return { ok: true, later: true };
    }
    // what he tells the shop about coming (not a final answer: he can still say he collected it, or does not want it)
    if (['coming', 'arrived', 'on_time', 'late', 'more_time'].includes(answer)) {
        const prev = order.pickupIntent;
        if (prev?.kind === answer && prev.at && Date.now() - new Date(prev.at).getTime() < REPEAT_MS) {
            const left = Math.max(1, Math.ceil((REPEAT_MS - (Date.now() - new Date(prev.at).getTime())) / 60000));
            throw httpError(429, `The shop already knows. You can tell them again in ${left} minute${left === 1 ? '' : 's'}.`);
        }
        await Order.updateOne({ _id: order._id }, { $set: { pickupIntent: { kind: answer, at: new Date() } } });
        {   // every answer reaches the owner now (on time too), with the details
            const spoken = require('../utils/orderSpeech');
            tell('pickup_intent', {
                tenantId: tenant._id,
                vars: { orderNo: order.orderNo, name: order.customer?.name, brief: brief(order, 3), kind: answer },
                data: { orderId: String(order._id), orderNo: order.orderNo, kind: answer, speech: spoken.pickupIntentSpeech(order, answer), speechHi: spoken.pickupIntentSpeech(order, answer, true), name: order.customer?.name || null, brief: brief(order, 3) },
            });
            require('./kitchenAlerts').tell(tenant._id, { orderId: String(order._id), orderNo: order.orderNo, status: order.status, ...(answer === 'arrived' ? { alert: { kind: 'here', orderNo: order.orderNo } } : {}) });
        }
        if (answer === 'more_time') await Order.updateOne({ _id: order._id }, { $set: { 'pickupClaim.snoozeUntil': new Date(Date.now() + SNOOZE_MS) } });
        return { ok: true, intent: answer };
    }
    if (!['collected', 'not_wanted'].includes(answer)) throw httpError(400, 'Choose collected, not wanted, later, coming, arrived, on time, late or more time');
    const r = await Order.updateOne({ _id: order._id, 'pickupClaim.kind': { $exists: false } }, { $set: { pickupClaim: { kind: answer, at: new Date() } } });
    if (!r.modifiedCount) return { ok: true, already: true };
    tell(answer === 'collected' ? 'pickup_collect_claim' : 'pickup_not_wanted_claim', {
        tenantId: tenant._id,
        vars: { orderNo: order.orderNo, name: order.customer?.name, brief: brief(order, 3), total: order.pricing?.total || 0, cod: cashDue(order) },
        data: { orderId: String(order._id), orderNo: order.orderNo },
    });
    return { ok: true };
}

/* ------------------------------ the owner's list and answers ------------------------------ */
async function claims(tenantId) {
    const pick = await Order.find({ tenantId, orderType: 'pickup', status: { $in: PICKUP_OPEN }, 'pickupClaim.kind': { $exists: true }, ...HIDE_UNPAID }).sort({ 'pickupClaim.at': 1 }).limit(20).lean();
    const tab = await Order.find({ tenantId, orderType: 'dine_in', status: { $in: TABLE_OPEN }, 'cancelRequest.at': { $exists: true } }).sort({ 'cancelRequest.at': 1 }).limit(20).lean();
    const row = (o, kind, at, note) => ({
        id: String(o._id), kind, orderNo: o.orderNo, status: o.status, at, note: note || null, table: o.tableNo || null,
        customer: { name: o.customer?.name || null, phone: o.customer?.phone || null },
        items: (o.items || []).map((l) => ({ name: l.name, quantity: l.quantity })),
        total: o.pricing?.total || 0, pay: { method: o.payment?.method, status: o.payment?.status }, cash: cashDue(o),
    });
    return [
        ...pick.map((o) => row(o, o.pickupClaim.kind === 'collected' ? 'collected' : 'not_wanted', o.pickupClaim.at)),
        ...tab.map((o) => row(o, 'cancel', o.cancelRequest.at, o.cancelRequest.note)),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
}

// an unpaid pickup becomes a bill he owes: reminders, the block on new orders and online paying all work as for a table
async function openPickupDebt({ order, owedPaise, strike }) {
    const now = new Date();
    const s = await TableSession.create({
        tenantId: order.tenantId, table: `Pickup #${order.orderNo}`, kind: 'pickup', orderId: order._id, status: 'closed', customers: [order.userId],
        openedAt: order.createdAt || now, closedAt: now, closedBy: 'owner', walkout: true, owedPaise,
    });
    await Order.updateOne({ _id: order._id }, { $set: { tableSessionId: s._id } });
    if (strike) await require('./customerRisk').addStrike(order).catch((e) => console.error('Strike error:', e.message));
    tell('table_walkout', { tenantId: order.tenantId, userId: order.userId, vars: { table: s.table, amount: Math.round(owedPaise / 100) }, data: { kind: 'table_owed', sessionId: String(s._id) } });
    return s;
}

async function answerClaim({ tenant, actor, orderId, body }) {
    const svc = require('./orderService');
    const orderStatus = require('./orderStatusService');
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id });
    if (!order) throw httpError(404, 'Order not found');
    const msg = msgOf(body?.message);
    const who = { type: 'owner', id: actor.id, label: actor.label };

    // ---- a table guest asked to cancel a round that is being made
    if (order.orderType === 'dine_in') {
        if (!order.cancelRequest?.at) throw httpError(404, 'There is nothing to answer for this order');
        if (!TABLE_OPEN.includes(order.status)) { await Order.updateOne({ _id: order._id }, { $unset: { cancelRequest: 1 } }); throw httpError(409, 'This order is already closed'); }
        if (typeof body?.accept !== 'boolean') throw httpError(400, 'Send accept: true or false');
        await Order.updateOne({ _id: order._id }, { $unset: { cancelRequest: 1 } });
        if (body.accept) {
            await svc.updateStatusByShop({ tenantId: tenant._id, actor: who, orderId, status: 'cancelled', reasonCode: 'mistake', note: msg || 'Cancelled as you asked. You are not charged.' });
        } else {
            tell('order_cancel_no', { tenantId: tenant._id, userId: order.userId, vars: { orderNo: order.orderNo, message: msg }, data: { orderId: String(order._id), orderNo: order.orderNo } });
        }
        return { ok: true, accepted: !!body.accept };
    }

    // ---- a pickup customer's answer at his pickup time
    const claim = order.pickupClaim;
    if (order.orderType !== 'pickup' || !claim?.kind) throw httpError(404, 'There is nothing to answer for this order');
    if (!PICKUP_OPEN.includes(order.status)) { await Order.updateOne({ _id: order._id }, { $unset: { pickupClaim: 1 } }); throw httpError(409, 'This order is already closed'); }
    const cash = cashDue(order);
    const total = order.pricing?.total || 0;
    const customerCtx = { tenantId: tenant._id, userId: order.userId, data: { orderId: String(order._id), orderNo: order.orderNo } };

    if (claim.kind === 'collected') {
        const result = body?.result;
        if (!['paid', 'unpaid', 'no'].includes(result)) throw httpError(400, 'Choose paid, unpaid or not collected');
        if (result === 'no') {
            await Order.updateOne({ _id: order._id }, { $unset: { pickupClaim: 1 } });
            tell('pickup_claim_no', { ...customerCtx, vars: { orderNo: order.orderNo, message: msg } });
            return { ok: true };
        }
        if (cash && result === 'unpaid') await openPickupDebt({ order, owedPaise: toPaise(total), strike: true });
        await svc.updateStatusByShop({ tenantId: tenant._id, actor: who, orderId, status: 'delivered', note: 'The customer collected it and the shop confirmed', skipCode: true });
        if (!(cash && result === 'unpaid')) tell('pickup_thanks', { ...customerCtx, vars: { orderNo: order.orderNo, message: msg } });
        return { ok: true };
    }

    // ---- he does not want the food: the owner chooses how much to give back
    const pct = Number(body?.refundPct);
    if (![100, 50, 25, 0].includes(pct)) throw httpError(400, 'Choose Full, Half, a quarter or none');
    const paidOnline = !cash && order.payment?.status === 'paid';
    const sorry = msg ? ` ${msg}` : '';
    if (paidOnline) {
        const paidPaise = toPaise(total);
        const refundPaise = Math.round((paidPaise * pct) / 100);
        const keptPaise = paidPaise - refundPaise;
        const word = pct === 100 ? 'in full' : pct === 50 ? 'half' : pct === 25 ? 'a quarter' : null;
        const note = pct === 0
            ? `Sorry we could not serve you this time. The food was already made, so there is no refund this time. Thank you for understanding.${sorry}`
            : `Sorry we could not serve you this time. Your refund of ₹${Math.round(refundPaise / 100)} (${word}) is on its way to your account.${sorry}`;
        await orderStatus.change({
            order, status: 'cancelled', actor: who, note, reasonCode: 'customer_asked', tenant,
            outcomeOverride: { reasonCode: 'customer_asked', refundReason: 'customer_asked', keptPaise, refundPaise, pct: 100 - pct, billable: keptPaise > 0, strike: false, couponReturn: keptPaise === 0, cod: false },
        });
        return { ok: true, refundPaise };
    }
    // cash: nothing was paid, so the choice is how much of the bill is dropped; the rest he still owes
    const owedPaise = Math.round((toPaise(total) * (100 - pct)) / 100);
    if (owedPaise <= 0) {
        await orderStatus.change({
            order, status: 'cancelled', actor: who, tenant, reasonCode: 'customer_asked',
            note: `Sorry we could not serve you this time. You do not need to pay anything. Thank you for understanding.${sorry}`,
            outcomeOverride: { reasonCode: 'customer_asked', refundReason: 'customer_asked', keptPaise: 0, refundPaise: 0, pct: 0, billable: false, strike: false, couponReturn: true, cod: true },
        });
        return { ok: true, owedPaise: 0 };
    }
    await openPickupDebt({ order, owedPaise, strike: false });
    await svc.updateStatusByShop({ tenantId: tenant._id, actor: who, orderId, status: 'delivered', note: `The customer did not want it. The shop asked him to pay ₹${Math.round(owedPaise / 100)}`, skipCode: true });
    return { ok: true, owedPaise };
}

/* ------------------------------ a table guest asks to cancel ------------------------------ */
function canAskCancel(order, tenant) {
    const { customerCanCancel } = require('./orderflow');
    return order.orderType === 'dine_in' && TABLE_OPEN.includes(order.status) && !order.cancelRequest?.at && !customerCanCancel(order, tenant);
}
async function askCancel({ tenant, userId, orderId, note }) {
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId, orderType: 'dine_in' });
    if (!order) throw httpError(404, 'Order not found');
    if (!TABLE_OPEN.includes(order.status)) throw httpError(409, 'This order can no longer be cancelled');
    if (order.cancelRequest?.at) throw httpError(409, 'You have already asked. Please wait for the shop to reply.');
    if (require('./orderflow').customerCanCancel(order, tenant)) throw httpError(409, 'You can cancel this order yourself');
    const r = await Order.updateOne({ _id: order._id, 'cancelRequest.at': { $exists: false } }, { $set: { cancelRequest: { at: new Date(), note: msgOf(note) || undefined } } });
    if (!r.modifiedCount) throw httpError(409, 'You have already asked');
    tell('order_cancel_request', {
        tenantId: tenant._id,
        vars: { orderNo: order.orderNo, name: order.customer?.name, brief: brief(order, 3), note: msgOf(note), where: `Table ${order.tableNo}` },
        data: { orderId: String(order._id), orderNo: order.orderNo, table: order.tableNo },
    });
    return Order.findById(order._id);
}

module.exports = { pickupDue, pickupAnswer, claims, answerClaim, canAskCancel, askCancel, openPickupDebt };
