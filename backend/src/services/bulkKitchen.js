// A paid bulk order gets a normal Order made behind the scenes, so the cook's queue, the rider offers, the PIN steps and live tracking work for it
// exactly like for any delivery or pickup. The bulk order keeps the quote, the money and the invoice; the Order is only the "work ticket".
//   - it is made ONCE, when the advance is paid (safe to call again: the link is claimed first)
//   - its total is the BALANCE only (what is still to be collected), as a Cash on delivery order; so a rider can never be asked for more than that
//   - it is hidden from the customer's order list, and it never counts for sales or rent a second time (the bulk order counts, once)
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
const Counter = require('../models/Counter');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const { hashPhone } = require('../utils/phoneHash');

async function nextOrderNo(tenantId) {
    const c = await Counter.findOneAndUpdate({ _id: `order:${tenantId}` }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
    return 1000 + c.seq;
}

const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

// the line the kitchen sees: the same dish and choices as the quote
const lineOf = (l) => ({
    productId: l.productId, name: l.name, image: l.image, isVeg: l.isVeg, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
    gstRate: l.gstRate, gstInclusive: l.gstInclusive, tax: l.tax || 0,
    selections: (l.selections || []).map((x) => ({ groupId: x.groupId, groupName: x.groupName, optionId: x.optionId, name: x.name || x.optionName, price: x.price })),
    note: l.note,
});

// What the cook and the rider are told besides the dishes
function notesOf(b) {
    const parts = [];
    if (b.packaging && b.packaging !== 'any') parts.push(`Pack in ${b.packaging}`);
    if (b.cutlery) parts.push('Include cutlery');
    if (b.note) parts.push(b.note);
    return text(parts.join('. '), 200);
}

// Makes the work ticket for a paid bulk order. Returns the Order (new or the one already made), or null when the bulk order is not paid / not live.
async function ensureLinkedOrder(bulkId) {
    const b = await BulkOrder.findById(bulkId).lean();
    if (!b || !b.payment?.advancePaymentId) return null;
    if (!['confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(b.status)) return null;
    if (b.orderId) return Order.findById(b.orderId);

    // claim the link first, so two runs at once make one Order
    const claim = await BulkOrder.findOneAndUpdate({ _id: b._id, orderId: { $exists: false }, linkingAt: { $exists: false } }, { $set: { linkingAt: new Date() } }, { returnDocument: 'after' }).lean();
    if (!claim) {
        const again = await BulkOrder.findById(b._id).select('orderId').lean();
        return again?.orderId ? Order.findById(again.orderId) : null;
    }
    try {
        const tenant = await Tenant.findById(b.tenantId).lean();
        const user = await User.findById(b.userId).select('name phone').lean();
        const q = b.quote || {};
        const balance = b.payment?.balancePaid ? 0 : (q.balancePaise || 0) / 100;
        const pricing = { ...(q.pricing || b.pricing || {}), total: balance };
        const phone = b.contact?.phone || user?.phone;
        const order = await Order.create({
            tenantId: b.tenantId, userId: b.userId, orderNo: await nextOrderNo(b.tenantId), bulkId: b._id,
            orderType: b.fulfilment === 'delivery' ? 'delivery' : 'pickup',
            status: 'accepted',   // the advance is paid, so the shop has the job: it goes straight to the cook
            items: (q.lines?.length ? q.lines : b.lines).map(lineOf),
            pricing,
            seller: { name: tenant?.business?.legalName || tenant?.name, gstin: tenant?.business?.gstin, fssai: tenant?.business?.fssai },
            // the balance is what is left to collect: cash (or the door QR) with the rider, or at the counter; paid online it is marked paid
            payment: b.payment?.balancePaid ? { method: 'cod', status: 'paid', paidAt: b.payment.balancePaidAt || new Date() } : { method: 'cod', status: 'pending' },
            customer: { name: b.contact?.name || user?.name, phone, phoneHash: phone ? hashPhone(b.tenantId, phone) : undefined },
            address: b.fulfilment === 'delivery' && b.address ? {
                label: b.address.label, name: b.contact?.name || b.address.name, phone: b.contact?.onSitePhone || b.address.phone || phone,
                line1: b.address.line1, line2: b.address.line2, landmark: b.address.landmark, city: b.address.city, pincode: b.address.pincode,
                latitude: b.address.latitude, longitude: b.address.longitude,
            } : undefined,
            scheduledFor: b.when,
            foodNote: notesOf(b),
            note: text(`Bulk order ${b.code}`, 300),
            statusHistory: [{ status: 'accepted', byType: 'system', byLabel: `Bulk order ${b.code}: advance paid` }],
        });
        await BulkOrder.updateOne({ _id: b._id }, { $set: { orderId: order._id }, $unset: { linkingAt: 1 } });
        // the cooks' screens and phones: a new order to make (the cook starts it when it is time; riders are asked once it is packed)
        require('./kitchenAlerts').onStatus({ before: { status: 'placed' }, updated: order, status: 'accepted' }).catch(log('cook alert'));
        return order;
    } catch (e) {
        await BulkOrder.updateOne({ _id: b._id }, { $unset: { linkingAt: 1 } }).catch(() => { });   // let the repair job try again
        throw e;
    }
}

/* ------------------------------ the ticket and the bulk order follow each other ------------------------------ */
const BULK = { type: 'system', label: 'bulk' };   // the one actor that may move or close a work ticket (orderStatusService.checkAllowed)
const log = (what) => (e) => console.error(`Bulk ticket ${what} error:`, e.message);

// where the bulk order should be, given the ticket (a delivery whose food the cook marked packed is "ready")
function stageOf(t) {
    if (t.status === 'delivered') return 'delivered';
    if (t.status === 'out_for_delivery') return 'out_for_delivery';
    if (t.status === 'ready') return 'ready';
    if (t.status === 'preparing') return t.orderType === 'delivery' && t.kitchen?.readyAt ? 'ready' : 'preparing';
    return null;
}

// The cook, the rider or the owner moved the ticket -> the bulk order goes to the same stage (the customer is told by the bulk order)
async function fromTicket(t) {
    const to = stageOf(t);
    if (!to || !t.bulkId) return null;
    const bulks = require('./bulkOrders');
    await bulks.advanceFromTicket({ bulkId: t.bulkId, to });
    if (to === 'delivered') {
        // the balance was collected with the delivery (cash with the rider, or at the counter): written down, and the order completes
        if (t.payment?.status === 'paid' && t.payment?.method === 'cod') await bulks.balanceFromTicket({ bulkId: t.bulkId, via: 'cash' });
        await bulks.tryComplete(t.bulkId);
    }
    return to;
}

// The cook marked a delivery packed. The bulk order says "ready" and the riders are asked now (not when the order was paid: that can be days before).
async function ticketReady(t) {
    await fromTicket(t);
    if (t.orderType === 'delivery' && !t.delivery?.riderId) {
        const asked = await require('./assignmentService').startBroadcast({ orderId: t._id, tenantId: t.tenantId }).catch(log('rider offer'));
        // manual assigning (no automatic offer went out): the owner is told it is packed and needs a rider. In automatic mode the offer, and "no rider free", already alert him.
        if (!asked && (await require('./assignmentService').settingsOf(t.tenantId)).assignMode !== 'automatic') require('./notificationService').noRiderFree({ tenantId: t.tenantId, orderId: t._id, orderNo: t.orderNo });
    }
}

// The bulk order moved (the owner's buttons): the ticket follows, so the cook's queue, the rider and the tracking agree with it
async function toTicket(bulk, to) {
    const id = bulk.orderId || (await ensureLinkedOrder(bulk._id))?._id;
    if (!id) return null;
    const change = (order, status, extraSet) => require('./orderStatusService').change({ order, status, actor: BULK, extraSet });
    let t = await Order.findById(id);
    if (!t || ['delivered', 'cancelled', 'undelivered'].includes(t.status)) return t;
    if (t.status === 'accepted' && ['preparing', 'ready', 'out_for_delivery', 'delivered'].includes(to)) t = await change(t, 'preparing');
    if (to === 'ready') {
        if (t.orderType === 'delivery') {
            if (!t.kitchen?.readyAt) {
                const u = await Order.findOneAndUpdate({ _id: t._id, status: 'preparing', 'kitchen.readyAt': { $exists: false } }, { $set: { 'kitchen.readyAt': new Date(), 'kitchen.readyByName': 'Owner' } }, { returnDocument: 'after' });
                if (u) await ticketReady(u);
                t = u || t;
            }
        } else if (t.status === 'preparing') t = await change(t, 'ready');
    }
    // A rider has this delivery: the rider's app moves it (pickup, delivered, the cash). The owner's button then only follows.
    if (t.delivery?.riderId && ['assigned', 'accepted', 'picked_up'].includes(t.delivery.status) && ['out_for_delivery', 'delivered'].includes(to)) return t;
    if (to === 'out_for_delivery' && ['preparing', 'ready'].includes(t.status)) t = await change(t, 'out_for_delivery');
    if (to === 'delivered' && ['preparing', 'ready', 'out_for_delivery'].includes(t.status)) {
        t = await change(t, 'delivered');
        // handing it over is not the same as the money: the balance is written down when the owner marks it received (bulkOrders.markCash)
        const fresh = await BulkOrder.findById(bulk._id).select('payment.balancePaid').lean();
        if (!fresh?.payment?.balancePaid && t.payment?.method === 'cod') t = await Order.findOneAndUpdate({ _id: t._id }, { $set: { 'payment.status': 'pending' } }, { returnDocument: 'after' });
    }
    return t;
}

// The bulk order was cancelled: the cook stops and the riders are not asked any more
async function closeTicket(bulk) {
    if (!bulk.orderId) return null;
    const t = await Order.findById(bulk.orderId);
    if (!t || ['delivered', 'cancelled', 'undelivered'].includes(t.status)) return t;
    // the money of a bulk order is handled by the bulk order itself (refunds by its own rules), so this cancel moves no money
    const outcomeOverride = { reasonCode: 'bulk_cancelled', refundReason: 'bulk_cancelled', keptPaise: 0, refundPaise: 0, pct: 0, billable: false, strike: false, couponReturn: false, cod: true };
    return require('./orderStatusService').change({ order: t, status: 'cancelled', actor: BULK, outcomeOverride, note: `Bulk order ${bulk.code} was cancelled` });
}

// The balance was paid some other way (the owner took cash, or the customer paid online): the rider must not ask for it
async function ticketPaid(bulkOrId) {
    const b = bulkOrId && bulkOrId.payment ? bulkOrId : await BulkOrder.findById(bulkOrId).select('orderId payment').lean();
    if (!b?.orderId || !b.payment?.balancePaid) return null;
    return Order.updateOne(
        { _id: b.orderId, 'payment.status': { $ne: 'paid' }, status: { $nin: ['delivered', 'cancelled', 'undelivered'] } },
        { $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), 'pricing.total': 0 } },   // still "cash" with nothing to collect (an online order would look like a payment to refund)
    );
}

module.exports = { ensureLinkedOrder, fromTicket, ticketReady, toTicket, closeTicket, ticketPaid };
