// A table booking whose deposit is "taken off the bill". When the guest gets onto a table bill near his booking time, his paid deposit is
// attached to that visit (TableSession.credit); the bill then asks for the rest (tableBill.billOf payable, tablePayment, settle).
// If the bill is smaller than the deposit, the shop keeps the difference.
const TableBooking = require('../models/TableBooking');
const TableSession = require('../models/TableSession');

const MIN = 60000;

async function attach(session, userId, now = new Date()) {
    if (!session || !userId || session.kind === 'pickup' || session.credit?.bookingId) return session;
    const date = new Date(now.getTime() + 330 * MIN).toISOString().slice(0, 10);
    const b = await TableBooking.findOneAndUpdate(
        {
            tenantId: session.tenantId, userId, date, status: { $in: ['confirmed', 'seated'] }, 'deposit.status': 'paid', 'rules.depositMode': 'adjust',
            startsAt: { $gte: new Date(now.getTime() - 4 * 60 * MIN), $lte: new Date(now.getTime() + 90 * MIN) },   // he came for this booking, not for lunch on a dinner booking day
        },
        { $set: { status: 'seated', 'deposit.status': 'adjusted', 'deposit.credit': 'applied', sessionId: session._id } },
        { returnDocument: 'after', sort: { startsAt: 1 } },
    );
    if (!b) return session;
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
