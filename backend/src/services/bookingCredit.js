// A guest with a paid table booking gets onto a table bill near his booking time ("arrives"). His booking is marked seated and tied to that visit
// (so the table is freed for others when the visit closes, tableBooking.freeFinished). If the deposit is "taken off the bill", it is attached to the
// visit (TableSession.credit) and the bill asks for the rest (tableBill.billOf payable, tablePayment, settle). If the bill is smaller than the deposit,
// the shop keeps the difference. If the deposit is "kept", it simply stays with the shop.
const TableBooking = require('../models/TableBooking');
const TableSession = require('../models/TableSession');

const MIN = 60000;

async function attach(session, userId, now = new Date()) {
    if (!session || !userId || session.kind === 'pickup' || session.credit?.bookingId) return session;
    const date = new Date(now.getTime() + 330 * MIN).toISOString().slice(0, 10);
    const where = {
        tenantId: session.tenantId, userId, date, status: { $in: ['confirmed', 'seated'] }, 'deposit.status': 'paid', sessionId: { $exists: false },
        startsAt: { $gte: new Date(now.getTime() - 4 * 60 * MIN), $lte: new Date(now.getTime() + 90 * MIN) },   // he came for this booking, not for lunch on a dinner booking day
    };
    const claim = { $set: { status: 'seated', sessionId: session._id } };
    const opts = { returnDocument: 'after', sort: { startsAt: 1 } };
    // the booking of THIS table first; if he sat at another table, his booking still counts
    const b = (await TableBooking.findOneAndUpdate({ ...where, table: String(session.table) }, claim, opts)) || (await TableBooking.findOneAndUpdate(where, claim, opts));
    if (!b) return session;
    if (b.rules?.depositMode !== 'adjust') { await TableBooking.updateOne({ _id: b._id }, { $set: { 'deposit.status': 'kept' } }); return session; }
    await TableBooking.updateOne({ _id: b._id }, { $set: { 'deposit.status': 'adjusted', 'deposit.credit': 'applied' } });
    const done = await TableSession.findOneAndUpdate(
        { _id: session._id, 'credit.bookingId': { $exists: false } },
        { $set: { credit: { amount: b.deposit.amount, bookingId: b._id, code: b.code, used: false } } },
        { returnDocument: 'after' },
    );
    if (!done) {   // the visit already had a deposit on it: give this one back
        await TableBooking.updateOne({ _id: b._id }, { $set: { status: 'confirmed', 'deposit.status': 'paid' }, $unset: { 'deposit.credit': 1, sessionId: 1 } });
        return session;
    }
    return done;
}

// the bill was settled: the deposit has been used (up to the size of the bill)
const consume = (sessionId, rupees) => TableSession.updateOne({ _id: sessionId, 'credit.bookingId': { $exists: true }, 'credit.used': { $ne: true } }, { $set: { 'credit.used': true, 'credit.appliedAmount': Math.round(rupees * 100) / 100 } });

module.exports = { attach, consume };
