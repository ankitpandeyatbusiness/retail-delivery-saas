// The kitchen screen: what the cook sees, and the three things a cook can do.
//   queue()    the orders to make (oldest start first) and the ones that are ready
//   start()    "Start cooking"   accepted  -> preparing
//   ready()    "Ready"           pickup and dine in: preparing -> ready.  Delivery: the order stays "preparing" (the rider takes it from there)
//                                and `kitchen.readyAt` says the food is packed.
//   problem()  "Tell the owner"  a dish is finished, or the cook cannot make it. The owner decides what to do with the order.
// A cook never sees money, a customer's phone or address. Which kinds of order a cook sees is the super admin's setting (orders.staff.kitchenSees).
const Order = require('../models/Order');
const Product = require('../models/Product');
const orderStatus = require('./orderStatusService');
const realtime = require('./realtime');
const staffService = require('./staffService');
const { kitchenSpeech } = require('../utils/orderSpeech');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');

const FIELDS = 'orderNo orderType status tableNo items note foodNote scheduledFor pickupUntil customer.name createdAt statusHistory kitchen payment tableSessionId tableParty pickupIntent';
const KINDS = { out_of_stock: 'a dish is finished', cannot_make: 'it cannot be made', other: 'there is a problem' };
const PROBLEM_GAP_MS = 2 * 60 * 1000;   // the same order: one message to the owner every two minutes at most

// the next 4 am in India (UTC+5:30): a finished dish is back on the menu then
function soldOutUntil(now = Date.now()) {
    const ist = new Date(now + 330 * 60000);
    const day = ist.getUTCHours() < 4 ? 0 : 1;
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + day, 4, 0) - 330 * 60000);
}

const rulesOf = (tenant) => staffService.rulesOf(tenant);
const sees = (tenant) => rulesOf(tenant).kitchenSees || ['delivery', 'pickup', 'dine_in'];
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

const at = (o, status) => {
    for (let i = (o.statusHistory || []).length - 1; i >= 0; i -= 1) if (o.statusHistory[i].status === status) return o.statusHistory[i].at;
    return null;
};

// a line of the order as the cook reads it: the dish, how many, the choices, the note
function lineOf(l) {
    return {
        productId: String(l.productId),
        name: l.name,
        quantity: l.quantity,
        isVeg: l.isVeg ?? null,
        options: (l.selections || []).map((s) => s.name).filter(Boolean),
        measure: l.measure?.label || null,
        note: l.note || '',
    };
}

// stage: 'new' (accepted, not started) | 'cooking' | 'ready'
function stageOf(o) {
    if (o.status === 'accepted') return 'new';
    if (o.status === 'preparing') return o.kitchen?.readyAt ? 'ready' : 'cooking';
    return 'ready';
}

function viewOf(o, { lateMin, now = Date.now() }) {
    const stage = stageOf(o);
    const accepted = at(o, 'accepted') || o.createdAt;
    // a pickup for later is not started early: it should start about 30 minutes before the time the customer will come
    const startAt = o.scheduledFor ? new Date(Math.max(new Date(accepted).getTime(), new Date(o.scheduledFor).getTime() - 30 * 60000)) : new Date(accepted);
    const waitedMin = Math.max(0, Math.floor((now - startAt.getTime()) / 60000));
    return {
        id: String(o._id),
        orderNo: o.orderNo,
        orderType: o.orderType,
        tableNo: o.tableNo || null,
        party: o.tableParty || null,   // shared tables: the bill's letter, shown next to the table number
        who: o.orderType === 'pickup' ? firstName(o.customer?.name) : '',
        intent: o.orderType === 'pickup' ? (o.pickupIntent?.kind || null) : null,   // coming | arrived | on_time | late | more_time: what the pickup customer said
        status: o.status,
        stage,
        acceptedAt: accepted,
        startAt,
        undo: require('./orderUndo').offer(o, 'staff', 'kitchen'),   // { label, secondsLeft }: the cook can take his last tap back
        startedAt: o.kitchen?.startedAt || null,
        readyAt: o.kitchen?.readyAt || null,
        startedByName: o.kitchen?.startedByName || null,
        readyByName: o.kitchen?.readyByName || null,
        scheduledFor: o.scheduledFor || null,
        waitedMin,
        late: stage !== 'ready' && waitedMin >= lateMin,
        early: startAt.getTime() - now > 5 * 60000,   // its start time is still some minutes away
        note: (o.orderType === 'dine_in' ? o.note : o.foodNote) || '',   // the cook sees what is for the kitchen: never the delivery instruction
        ...(stage === 'new' ? { speech: kitchenSpeech(o), speechHi: kitchenSpeech(o, true) } : {}),   // the Soundbox reads it out while the order waits
        items: (o.items || []).map(lineOf),
        problem: o.kitchen?.problem?.at ? { kind: o.kitchen.problem.kind, note: o.kitchen.problem.note || '', at: o.kitchen.problem.at, dish: o.kitchen.problem.dish || null, handledAt: o.kitchen.problem.handledAt || null, handledAction: o.kitchen.problem.handledAction || null } : null,
    };
}

async function queue(tenant) {
    const types = sees(tenant);
    const lateMin = rulesOf(tenant).lateMin || 20;
    const now = Date.now();
    const rows = await Order.find({
        tenantId: tenant._id, orderType: { $in: types }, status: { $in: ['accepted', 'preparing', 'ready'] }, ...HIDE_UNPAID,
        // a ready order stays on the list for an hour, then it is the owner's to finish
        $or: [{ status: { $ne: 'ready' } }, { updatedAt: { $gte: new Date(now - 60 * 60000) } }],
    }).select(FIELDS).sort({ createdAt: 1 }).limit(150).lean();

    const all = rows.map((o) => viewOf(o, { lateMin, now }));
    const make = all.filter((o) => o.stage !== 'ready').sort((a, b) => new Date(a.startAt) - new Date(b.startAt) || a.orderNo - b.orderNo);
    const done = all.filter((o) => o.stage === 'ready').sort((a, b) => new Date(b.readyAt || b.acceptedAt) - new Date(a.readyAt || a.acceptedAt)).slice(0, 30);
    return {
        items: [...make, ...done],
        counts: { new: make.filter((o) => o.stage === 'new').length, cooking: make.filter((o) => o.stage === 'cooking').length, ready: done.length, late: make.filter((o) => o.late).length },
        rules: { lateMin, sees: types },
        now: new Date(now),
    };
}

async function loadFor(tenant, orderId) {
    const o = await Order.findOne({ _id: orderId, tenantId: tenant._id });
    if (!o || !sees(tenant).includes(o.orderType)) throw httpError(404, 'Order not found');
    return o;
}
const view = (tenant, o) => viewOf(o.toObject ? o.toObject() : o, { lateMin: rulesOf(tenant).lateMin || 20 });
const ago = (d) => { const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };

const gone = (o) => {
    if (o.status === 'cancelled') return httpError(409, 'This order was cancelled. Stop making it.');
    if (['delivered', 'out_for_delivery', 'undelivered'].includes(o.status)) return httpError(409, `This order has already gone (${o.status.replace(/_/g, ' ')}).`);
    return null;
};

async function start({ tenant, orderId, staff }) {
    const o = await loadFor(tenant, orderId);
    if (o.status === 'preparing' || o.status === 'ready') {   // a second cook tapped, or this one tapped twice: nothing to do
        return { already: true, by: o.kitchen?.startedByName || null, ago: o.kitchen?.startedAt ? ago(o.kitchen.startedAt) : null, order: view(tenant, o) };
    }
    const g = gone(o); if (g) throw g;
    if (o.status !== 'accepted') throw httpError(409, 'This order is not ready to be cooked yet. The shop has to accept it first.');
    const now = new Date();
    let updated;
    try {
        updated = await orderStatus.change({
            order: o, status: 'preparing', actor: { type: 'staff', role: 'kitchen', id: staff.id, label: staff.name }, tenant,
            extraSet: { 'kitchen.startedAt': now, 'kitchen.startedBy': staff.id, 'kitchen.startedByName': staff.name },
        });
    } catch (e) {
        // another cook started it in the same moment: say who, instead of an error
        const fresh = e.status === 409 ? await Order.findById(o._id) : null;
        if (fresh && ['preparing', 'ready'].includes(fresh.status)) return { already: true, by: fresh.kitchen?.startedByName || null, ago: fresh.kitchen?.startedAt ? ago(fresh.kitchen.startedAt) : null, order: view(tenant, fresh) };
        throw e;
    }
    return { already: false, order: view(tenant, updated) };
}

async function ready({ tenant, orderId, staff }) {
    const o = await loadFor(tenant, orderId);
    if (o.kitchen?.readyAt || o.status === 'ready') {
        return { already: true, by: o.kitchen?.readyByName || null, ago: o.kitchen?.readyAt ? ago(o.kitchen.readyAt) : null, order: view(tenant, o) };
    }
    const g = gone(o); if (g) throw g;
    if (o.status === 'accepted') throw httpError(409, 'Start cooking first.');
    if (o.status !== 'preparing') throw httpError(409, 'This order is not being cooked.');
    const now = new Date();
    const mark = { 'kitchen.readyAt': now, 'kitchen.readyBy': staff.id, 'kitchen.readyByName': staff.name };

    if (o.orderType !== 'delivery') {
        const updated = await orderStatus.change({ order: o, status: 'ready', actor: { type: 'staff', role: 'kitchen', id: staff.id, label: staff.name }, tenant, extraSet: mark });
        return { already: false, order: view(tenant, updated) };
    }
    // delivery: the status stays "preparing" for the rider; only the first tap counts
    const updated = await Order.findOneAndUpdate({ _id: o._id, tenantId: tenant._id, status: 'preparing', 'kitchen.readyAt': { $exists: false } }, { $set: mark }, { returnDocument: 'after' });
    if (!updated) {
        const fresh = await Order.findById(o._id);
        if (fresh?.kitchen?.readyAt) return { already: true, by: fresh.kitchen.readyByName || null, ago: ago(fresh.kitchen.readyAt), order: view(tenant, fresh) };
        throw httpError(409, 'This order just changed. Refresh and try again.');
    }
    realtime.toOwner(tenant._id, 'order:update', { orderId: String(o._id), orderNo: o.orderNo, status: o.status, kind: 'kitchen_ready' });
    if (updated.delivery?.riderId) realtime.toUser(tenant._id, updated.delivery.riderId, 'order:update', { orderId: String(o._id), orderNo: o.orderNo, status: o.status, kind: 'kitchen_ready' });
    require('./kitchenAlerts').tell(tenant._id, { orderId: String(o._id), orderNo: o.orderNo, status: updated.status });
    if (updated.delivery?.riderId && ['assigned', 'accepted'].includes(updated.delivery.status)) {   // the rider who is coming for it knows it is packed
        require('../notifications/center').notify('food_packed_rider', { tenantId: tenant._id, userId: updated.delivery.riderId, data: { orderId: String(o._id), orderNo: o.orderNo }, vars: { orderNo: o.orderNo, brief: require('../utils/orderBrief').brief(updated, 2) } });
    }
    return { already: false, order: view(tenant, updated) };
}

// Tells the owner. The order is left as it is: the owner decides (cancel it, wait, change it). A dish that is finished is switched off on the menu.
async function problem({ tenant, orderId, staff, kind, note, productId }) {
    if (!KINDS[kind]) throw httpError(400, 'Choose what the problem is');
    const text = typeof note === 'string' ? note.trim().slice(0, 140) : '';
    if (kind === 'other' && text.length < 3) throw httpError(400, 'Please write the problem');
    const o = await loadFor(tenant, orderId);
    const g = gone(o); if (g) throw g;
    let dish = null;
    if (kind === 'out_of_stock' && productId) {
        const line = o.items.find((l) => String(l.productId) === String(productId));
        if (!line) throw httpError(400, 'That dish is not in this order');
        dish = line.name;
    }
    // each dish counts on its own: telling the owner about one dish never blocks another. Only the same thing again within two minutes waits.
    const last = o.kitchen?.problem;
    if (last?.at && !last.handledAt && last.kind === kind && (last.dish || null) === dish && Date.now() - new Date(last.at).getTime() < PROBLEM_GAP_MS) {
        throw httpError(429, dish ? `The owner was just told that ${dish} is finished. Please wait a moment.` : 'The owner was just told about this order. Please wait a moment.');
    }
    if (dish) {
        const line = o.items.find((l) => String(l.productId) === String(productId));
        // customers see "sold out" at once (the menu follows by itself). It switches on again by itself at 4 am (India time); the owner can bring it back sooner.
        await Product.updateOne({ _id: line.productId, tenantId: tenant._id }, { $set: { isAvailable: false, unavailableUntil: soldOutUntil() } });
    }
    await Order.updateOne({ _id: o._id, tenantId: tenant._id }, { $set: { 'kitchen.problem': { kind, note: text, at: new Date(), byName: staff.name, ...(dish ? { dish } : {}) } } });
    const what = kind === 'out_of_stock' ? `${dish || 'a dish'} is finished` : kind === 'cannot_make' ? 'it cannot be made' : 'there is a problem';
    require('../notifications/center').notify('kitchen_problem', {
        tenantId: tenant._id,
        data: { orderId: String(o._id), orderNo: o.orderNo, kind, what, byName: staff.name, speech: `Kitchen problem. Order ${o.orderNo}. ${what.charAt(0).toUpperCase()}${what.slice(1)}.`, speechHi: `किचन में समस्या। ऑर्डर ${o.orderNo}।` },
        vars: { orderNo: o.orderNo, name: staff.name, what, note: text },
    });
    realtime.toOwner(tenant._id, 'order:update', { orderId: String(o._id), orderNo: o.orderNo, status: o.status, kind: 'kitchen_problem' });
    return { ok: true, dishOff: !!dish };
}

// The polite words for the customer. "tell" keeps the order going; "cancel" ends it (the money goes back by itself when it was paid online).
const sorryText = (p, action, paidOnline) => {
    const dish = p?.dish || 'one item in your order';
    if (action === 'cancel') {
        const base = p?.kind === 'out_of_stock' ? `Sorry, ${dish} is finished and we cannot make your order.` : 'Sorry, we cannot make your order right now.';
        return `${base} We are very sorry for the trouble.${paidOnline ? ' Your full payment will be refunded.' : ''}`;
    }
    if (p?.kind === 'out_of_stock') return `Sorry, ${dish} just ran out at the shop. Your order may take a little longer, or we will call you. Thank you for your patience.`;
    if (p?.kind === 'cannot_make') return 'Sorry, we are having trouble making one item in your order. We will update you shortly. Thank you for your patience.';
    return 'Sorry for the wait. We hit a small problem with your order and are sorting it out. Thank you for your patience.';
};

// The owner decides what to do about a cook's problem: { action: 'tell' | 'cancel' | 'dismiss', message? }
// tell: a polite note goes to the customer. cancel: the order is cancelled with the same politeness (refund by itself when paid online).
async function resolve({ tenant, order, action, message, actor }) {
    if (!['tell', 'cancel', 'dismiss'].includes(action)) throw httpError(400, 'Choose what to do');
    const p = order.kitchen?.problem;
    if (!p?.at) throw httpError(409, 'The kitchen has not reported a problem on this order.');
    if (p.handledAt) throw httpError(409, 'You already dealt with this.');
    const custom = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    const paidOnline = order.payment?.method && order.payment.method !== 'cod' && order.payment.status === 'paid';
    const text = custom || sorryText(p, action, paidOnline);
    let current = order;
    if (action === 'cancel') {
        if (!['accepted', 'preparing', 'ready'].includes(order.status)) throw httpError(409, `This order is "${order.status}" and cannot be cancelled.`);
        current = await orderStatus.change({ order, status: 'cancelled', actor, reasonCode: 'out_of_stock', note: text, tenant });
    } else if (action === 'tell') {
        require('../notifications/center').notify('order_shop_note', {
            tenantId: tenant._id, userId: order.userId, data: { orderId: String(order._id), orderNo: order.orderNo }, vars: { orderNo: order.orderNo, text },
        });
    }
    await Order.updateOne({ _id: order._id, tenantId: tenant._id }, { $set: { 'kitchen.problem.handledAt': new Date(), 'kitchen.problem.handledAction': action } });
    realtime.toOwner(tenant._id, 'order:update', { orderId: String(order._id), orderNo: order.orderNo, status: current.status, kind: 'kitchen_problem_done' });
    // the cook's card stops waiting: it now says what the owner did
    require('./kitchenAlerts').tell(tenant._id, { orderId: String(order._id), orderNo: order.orderNo, status: current.status });
    return { ok: true, action, text };
}

module.exports = { queue, start, ready, problem, resolve, viewOf, stageOf };
