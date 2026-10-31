// Reservations that fall on a day (or hour) the shop is now closed: a holiday added later, a weekly day off, a closed day or slot the owner set.
// Nothing cancels them by itself: the owner is told (the settings screens, a reminder) and chooses to cancel and refund them all.
const TableBooking = require('../models/TableBooking');
const tb = require('./tableBooking');
const bp = require('./bookingPayment');

const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

// the upcoming confirmed reservations of one shop that fall on a closed time (newest first is not needed: by start)
async function closed(tenantId, now = new Date()) {
    const config = await tb.getConfig(tenantId);
    const rows = await TableBooking.find({ tenantId, status: 'confirmed', startsAt: { $gt: now } }).sort({ startsAt: 1 }).limit(500).lean();
    return rows.filter((b) => tb.closedFor(config, b.date, b.time));
}

// cancel them all, each with a refund of the deposit (the same path as the owner's Cancel), and tell each guest
async function cancelAll(tenant, message = '') {
    const text = String(message || 'The restaurant is closed on that day.').trim().slice(0, 300);
    const rows = await closed(tenant._id);
    let cancelled = 0;
    let refunds = 0;
    for (const r of rows) {
        const b = await TableBooking.findOne({ _id: r._id, tenantId: tenant._id });
        if (!b) continue;
        const done = await bp.cancelBooking(b, 'owner', { message: text });
        if (!done) continue;
        cancelled += 1;
        const refund = ['refunding', 'refunded', 'refund_failed'].includes(done.deposit.status);
        if (refund) refunds += 1;
        tell('booking_owner_cancelled', { tenantId: done.tenantId, userId: done.userId, vars: { shop: tenant.name, date: done.date, time: done.time, message: text, refund, amount: done.deposit.amount }, data: { kind: 'booking', bookingId: String(done._id) } });
    }
    return { cancelled, refunds };
}

module.exports = { closed, cancelAll };
