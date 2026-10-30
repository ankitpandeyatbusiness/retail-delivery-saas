// The booking ticket: the QR a guest shows at the door, and the check the owner or a waiter makes when it is scanned.
// The QR holds only a signed token (TB1.<bookingId>.<signature>), never the details: the server looks everything up,
// so a QR cannot be edited to change a table or a time. The short booking code can be typed in when a camera fails.
const crypto = require('crypto');
const QRCode = require('qrcode');
const TableBooking = require('../models/TableBooking');
const tb = require('./tableBooking');
const bp = require('./bookingPayment');
const { httpError } = require('../middlewares/apiErrors');

const EARLY_MIN = 15;   // a guest may be marked arrived from 15 minutes before his slot

const secret = () => process.env.JWT_ACCESS_SECRET || '';
const sign = (id) => crypto.createHmac('sha256', secret()).update(`booking-ticket:${id}`).digest('hex').slice(0, 20);
const tokenOf = (booking) => `TB1.${booking._id}.${sign(booking._id)}`;

// token -> booking id, or null when it is not one of ours (or was changed)
function idFromToken(raw) {
    const m = /^TB1\.([a-f0-9]{24})\.([a-f0-9]{20})$/.exec(String(raw || '').trim());
    if (!m) return null;
    const a = Buffer.from(sign(m[1])); const b = Buffer.from(m[2]);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}

// QR cells for the app and the PDF: { size, rows: ['0110..', ...] } (1 = dark)
function matrixOf(text) {
    const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = q.modules.size;
    const rows = [];
    for (let y = 0; y < size; y++) {
        let r = '';
        for (let x = 0; x < size; x++) r += q.modules.get(y, x) ? '1' : '0';
        rows.push(r);
    }
    return { size, rows };
}

// a guest holds a ticket only for a booking that is paid and that the owner allowed
const ticketable = (b) => ['confirmed', 'seated'].includes(b.status) && !!b.approvedAt && b.deposit?.status !== 'unpaid';

// the slot is over: the ticket is no longer shown or issued
const over = (b, now = Date.now()) => now > (b.endsAt ? new Date(b.endsAt).getTime() : new Date(b.startsAt).getTime() + 60 * 60000);

function ticketFor(b, tenant, now = Date.now()) {
    if (over(b, now)) throw httpError(410, 'This booking time is over');
    if (!ticketable(b)) throw httpError(404, 'There is no ticket for this booking yet');
    const token = tokenOf(b);
    return {
        id: String(b._id), token, code: b.code, shop: tenant?.name || '', name: b.name, table: b.table || null, date: b.date, time: b.time, party: b.party,
        startsAt: b.startsAt, endsAt: b.endsAt || null, status: b.status, arrivedAt: b.arrivedAt || null, qr: matrixOf(token),
    };
}

// what the scanner shows. state: ok | arrived | early | late | wrong_day | cancelled | unpaid | not_allowed | not_found
async function check(tenant, input, now = Date.now()) {
    const raw = String(input || '').trim();
    let b = null;
    const id = idFromToken(raw);
    if (id) b = await TableBooking.findOne({ _id: id, tenantId: tenant._id }).lean();
    else if (/^[A-Za-z0-9]{5}$/.test(raw)) {
        // typed code: today's bookings (and tomorrow's early morning) of this shop with that code
        b = await TableBooking.findOne({ tenantId: tenant._id, code: raw.toUpperCase(), date: { $in: [tb.todayYmd(now), tb.todayYmd(now - 86400000)] }, status: { $in: ['confirmed', 'seated'] } }).sort({ startsAt: -1 }).lean();
    }
    if (!b) return { state: 'not_found', message: 'This is not a booking of this shop' };

    const show = { id: String(b._id), name: b.name, phone: b.phone, table: b.table || null, date: b.date, time: b.time, party: b.party, code: b.code, arrivedAt: b.arrivedAt || null, status: b.status };
    if (b.status === 'cancelled' || b.status === 'expired') return { state: 'cancelled', message: 'This booking was cancelled', booking: show };
    if (b.status === 'no_show') return { state: 'late', message: 'This booking was marked as a no-show', booking: show };
    if (b.status === 'held' || b.deposit?.status === 'unpaid') return { state: 'unpaid', message: 'The deposit is not paid for this booking', booking: show };
    if (b.status === 'seated') return { state: 'arrived', message: 'This guest has already arrived', booking: show };
    if (!b.approvedAt) return { state: 'not_allowed', message: 'You have not allowed this booking yet. Allow it first.', booking: show };

    const start = new Date(b.startsAt).getTime();
    const end = b.endsAt ? new Date(b.endsAt).getTime() : start + 60 * 60000;
    if (tb.todayYmd(now) !== b.date && now < start - EARLY_MIN * 60000) return { state: 'wrong_day', message: 'This booking is for another day', booking: show };
    if (now < start - EARLY_MIN * 60000) return { state: 'early', message: 'Too early. Guests can come in from 15 minutes before their time', booking: show };
    if (now > end) return { state: 'late', message: 'This booking time is over', booking: show };
    return { state: 'ok', message: 'Valid booking', booking: show };
}

// "Mark arrived": the guest is seated. The deposit then follows the shop's rule (taken off the bill, or kept).
async function arrive(tenant, input, actor, now = Date.now()) {
    const c = await check(tenant, input, now);
    if (c.state !== 'ok') return c;
    const done = await TableBooking.findOneAndUpdate(
        { _id: c.booking.id, tenantId: tenant._id, status: 'confirmed' },   // two scanners at once: only one wins
        { $set: { status: 'seated', arrivedAt: new Date(now), arrivedBy: actor || {} } },
        { new: true },
    );
    if (!done) return { ...(await check(tenant, input, now)) };
    await bp.seated(done);
    return { state: 'arrived_now', message: 'Marked as arrived', booking: { ...c.booking, status: 'seated', arrivedAt: done.arrivedAt } };
}

module.exports = { EARLY_MIN, over, tokenOf, idFromToken, matrixOf, ticketable, ticketFor, check, arrive };
