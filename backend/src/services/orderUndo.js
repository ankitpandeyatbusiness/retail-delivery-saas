// "Undo" for the last step of an order, for a mistaken tap: the cook (Start cooking, Ready), the waiter (Served), the rider (Picked up), the shop
// owner and the superadmin (any of them, with more time). Only steps with no money attached can be undone; a cancelled order, a delivered delivery
// (cash, rider pay, points) and a closed table bill cannot. Each undo is written in the order's history ("Undo: Ready, by Ramesh"), so the owner sees it.
//
//   await orderUndo.undo({ order, actor, tenant })   actor: { type: 'owner' | 'superadmin' | 'staff' | 'rider', role?, id, label }
//   orderUndo.stepOf(order)                           the step that could be undone now, or null: { id, label, at }
//
// How long after the step it can be undone: staff and riders 5 minutes, the owner 30 minutes, the superadmin 24 hours.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const realtime = require('./realtime');
const { httpError } = require('../middlewares/apiErrors');

const MIN = 60000;
const WINDOW = { staff: 5 * MIN, rider: 5 * MIN, owner: 30 * MIN, superadmin: 24 * 60 * MIN };
const KITCHEN_READY = ['kitchen.readyAt', 'kitchen.readyBy', 'kitchen.readyByName'];
const KITCHEN_START = ['kitchen.startedAt', 'kitchen.startedBy', 'kitchen.startedByName'];

// when the order reached its current status (the newest history row of that status)
function reachedAt(o) {
    const rows = (o.statusHistory || []).filter((h) => h.status === o.status);
    const at = rows.length ? rows[rows.length - 1].at : null;
    return at ? new Date(at) : (o.updatedAt ? new Date(o.updatedAt) : null);
}

// every step that can be undone, in the order they are checked. `to`: the status afterwards (same status when only a mark on the order goes).
const STEPS = [
    {   // a delivery order's "food is packed" mark (the status stays "preparing")
        id: 'ready', label: 'Ready', roles: ['kitchen'],
        applies: (o) => o.status === 'preparing' && !!o.kitchen?.readyAt,
        at: (o) => new Date(o.kitchen.readyAt), to: 'preparing', unset: KITCHEN_READY, statusChange: false,
    },
    {   // pickup or dine in: "ready" is a status
        id: 'ready', label: 'Ready', roles: ['kitchen'],
        applies: (o) => o.status === 'ready' && o.orderType !== 'delivery',
        at: reachedAt, to: 'preparing', unset: KITCHEN_READY,
    },
    {
        id: 'started', label: 'Start cooking', roles: ['kitchen'],
        applies: (o) => o.status === 'preparing' && !o.kitchen?.readyAt,
        at: (o) => (o.kitchen?.startedAt ? new Date(o.kitchen.startedAt) : reachedAt(o)), to: 'accepted', unset: KITCHEN_START,
    },
    {   // a dish served at the table, or a pickup handed over (money has not moved for these: a table bill is settled separately)
        id: 'served', label: 'Served', roles: ['waiter'],
        applies: (o) => o.status === 'delivered' && (o.orderType === 'dine_in' || o.orderType === 'pickup'),
        at: (o) => (o.deliveredAt ? new Date(o.deliveredAt) : reachedAt(o)), to: 'ready', unset: ['deliveredAt'],
    },
    {   // the rider collected the food by mistake (before he has delivered it)
        id: 'picked_up', label: 'Picked up', roles: ['rider'],
        applies: (o) => o.status === 'out_for_delivery' && o.orderType === 'delivery' && o.delivery?.status === 'picked_up',
        at: (o) => (o.delivery?.pickedUpAt ? new Date(o.delivery.pickedUpAt) : reachedAt(o)), to: 'preparing', unset: ['delivery.pickedUpAt', 'delivery.dueAt'],
        set: { 'delivery.status': 'accepted' },
    },
];

const stepFor = (o) => STEPS.find((s) => s.applies(o)) || null;

// the step that could be undone now (the time is checked by undo())
function stepOf(o) {
    const s = stepFor(o);
    return s ? { id: s.id, label: s.label, at: s.at(o) } : null;
}

const windowOf = (actor) => WINDOW[actor.type] || 0;

function checkActor(step, o, actor) {
    if (actor.type === 'owner' || actor.type === 'superadmin') return;
    if (actor.type === 'staff') {
        if (!step.roles.includes(actor.role)) throw httpError(403, 'You cannot undo this');
        if (actor.role === 'waiter' && o.orderType !== 'dine_in') throw httpError(403, 'A waiter can undo only a dish served at a table');
        return;
    }
    if (actor.type === 'rider') {
        if (step.id !== 'picked_up') throw httpError(403, 'You cannot undo this');
        if (String(o.delivery?.riderId) !== String(actor.id)) throw httpError(403, 'This order is not assigned to you');
        return;
    }
    throw httpError(403, 'You cannot undo this');
}

// What the screen shows: { label, secondsLeft } when this person could undo the order's last step right now, else null.
// (The table bill check is made when the undo is asked for, not here.)
function offer(o, type, role) {
    try {
        const step = stepFor(o);
        if (!step) return null;
        checkActor(step, o, { type, role, id: type === 'rider' ? o.delivery?.riderId : undefined });
        const at = step.at(o);
        const left = at ? windowOf({ type }) - (Date.now() - at.getTime()) : windowOf({ type });
        return left > 0 ? { label: step.label, secondsLeft: Math.floor(left / 1000), until: new Date(Date.now() + left) } : null;
    } catch (e) { return null; }
}

async function undo({ order, actor }) {
    if (!order) throw httpError(404, 'Order not found');
    const step = stepFor(order);
    if (!step) throw httpError(409, 'There is nothing to undo on this order.');
    checkActor(step, order, actor);
    // a delivered delivery has cash, rider pay and points behind it; a closed table bill has been paid
    if (order.status === 'delivered' && order.tableSessionId) {
        const s = await TableSession.findOne({ _id: order.tableSessionId, tenantId: order.tenantId }).select('status').lean();
        if (!s || s.status !== 'open') throw httpError(409, 'The table bill is already closed, so this cannot be undone.');
    }
    const at = step.at(order);
    const limit = windowOf(actor);
    if (at && Date.now() - at.getTime() > limit) {
        const m = Math.round(limit / MIN);
        throw httpError(409, `Too late to undo: it can be undone within ${m >= 120 ? `${Math.round(m / 60)} hours` : `${m} minutes`}.`);
    }

    const set = { ...(step.set || {}) };
    const unset = {};
    for (const k of step.unset || []) unset[k] = '';
    // a pickup paid in cash on handover goes back to unpaid
    if (step.id === 'served' && order.payment?.method === 'cod' && order.payment?.status === 'paid' && !order.tableSessionId) set['payment.status'] = 'pending';
    const change = step.statusChange !== false;
    if (change) set.status = step.to;
    const label = actor.label ? String(actor.label).slice(0, 80) : actor.type;

    const filter = { _id: order._id, tenantId: order.tenantId, status: order.status };
    if (step.id === 'ready' && order.orderType === 'delivery') filter['kitchen.readyAt'] = { $exists: true };
    const updated = await Order.findOneAndUpdate(filter, {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $push: { statusHistory: { status: step.to, by: actor.id || undefined, byType: actor.type, byLabel: label, note: `Undo: ${step.label}` } },
    }, { returnDocument: 'after' });
    if (!updated) throw httpError(409, 'This order just changed. Refresh and try again.');

    // every screen that shows this order loads it again (no sound: an undo is a correction)
    const p = { orderId: String(updated._id), orderNo: updated.orderNo, status: updated.status, kind: 'undo' };
    realtime.toOwner(updated.tenantId, 'order:update', p);
    realtime.toOrder(updated._id, 'order:update', p);
    if (updated.delivery?.riderId) realtime.toUser(updated.tenantId, updated.delivery.riderId, 'order:update', p);
    try { require('./kitchenAlerts').tell(updated.tenantId, { orderId: p.orderId, orderNo: p.orderNo, status: updated.status }); } catch (e) { /* the screens refresh by themselves */ }
    try { if (updated.orderType === 'dine_in') require('./waiterAlerts').tell(updated.tenantId, { orderId: p.orderId, orderNo: p.orderNo, table: updated.tableNo, status: updated.status }); } catch (e) { /* the screens refresh by themselves */ }
    if (step.id === 'picked_up') require('./liveTracking').orderChanged(updated.delivery.riderId);
    return { order: updated, undone: step.label };
}

module.exports = { undo, stepOf, offer, WINDOW };
