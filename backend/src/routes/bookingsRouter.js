// What a customer sees and does for table booking. Mounted at /api/bookings.
//   GET /config                       { enabled, minParty, maxParty, advanceDays, today, deposit: { type, amount, mode, refundHours } }
//   GET /slots?date=YYYY-MM-DD&party=4  { date, slots: [{ time, left, ok }], deposit }
//   GET /tables?date&time&party       the tables of a slot: [{ no, seats, state: free | taken | small }]
//   POST /waitlist { date, time, party, name, phone }   GET /waitlist/mine   DELETE /waitlist/:id   (for a slot with no free table)
//   POST /                            { date, time, party, table, name, phone, note? }  ->  { booking, pay }  the seats are held for holdMinutes until the deposit is paid
//   POST /:id/pay     again, to pay a booking that is still held        ->  { booking, pay }
//   POST /:id/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }   POST /:id/check
//   GET /mine      POST /:id/cancel  (the deposit goes back by the rule the guest saw)
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const TableBooking = require('../models/TableBooking');
const User = require('../models/User');
const tb = require('../services/tableBooking');
const bp = require('../services/bookingPayment');
const wl = require('../services/bookingWaitlist');
const featureGate = require('../services/featureGate');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const mineBooking = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Booking not found');
    const b = await TableBooking.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!b) throw httpError(404, 'Booking not found');
    return b;
};
const rules = (c) => ({ type: c.depositType, amount: c.depositAmount, mode: c.depositMode, refundHours: c.refundHours });

const on = async (req) => {
    const c = await tb.getConfig(req.tenant._id);
    if (!c.enabled || !featureGate.isOn(req.tenant, 'tableBooking')) throw httpError(404, 'Table booking is not available at this shop');
    return c;
};

router.get('/config', wrap(async (req, res) => {
    const c = await tb.getConfig(req.tenant._id);
    const me = c.enabled ? await User.findById(req.auth.userId).select('name phone').lean() : null;
    res.json({ enabled: !!c.enabled && featureGate.isOn(req.tenant, 'tableBooking') && (await bp.available(c.tenantId)), holdMinutes: c.holdMinutes, minParty: c.minParty, maxParty: tb.maxPartyOf(c), tables: tb.bookable(c).map((t) => ({ no: t.no, seats: t.seats })), advanceDays: c.advanceDays, today: tb.todayYmd(), deposit: rules(c), me: { name: me?.name || '', phone: me?.phone || '' } });
}));

router.get('/slots', wrap(async (req, res) => {
    const c = await on(req);
    const party = Math.round(Number(req.query.party)) || c.minParty;
    res.json({ date: req.query.date, slots: await tb.availability(c, req.query.date, party), deposit: tb.depositFor(c, party), waiting: await require('../models/WaitlistEntry').find({ tenantId: c.tenantId, userId: req.auth.userId, date: req.query.date, status: 'waiting' }).select('time party').lean() });
}));

router.get('/tables', wrap(async (req, res) => {
    const c = await on(req);
    const party = Math.round(Number(req.query.party)) || c.minParty;
    res.json({ date: req.query.date, time: req.query.time, tables: await tb.tablesFor(c, req.query.date, req.query.time, party), deposit: tb.depositFor(c, party) });
}));

router.post('/waitlist', wrap(async (req, res) => {
    const c = await on(req);
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const phone = String(b.phone || '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Please enter your name');
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw httpError(400, 'Please enter your phone number');
    res.status(201).json(await wl.join({ config: c, userId: req.auth.userId, name, phone, date: b.date, time: b.time, party: b.party }));
}));
router.get('/waitlist/mine', wrap(async (req, res) => { res.json({ items: await wl.mine(req.tenant._id, req.auth.userId) }); }));
router.delete('/waitlist/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Not found');
    await wl.leave(req.tenant._id, req.auth.userId, req.params.id);
    res.json({ ok: true });
}));

router.post('/', wrap(async (req, res) => {
    const c = await on(req);
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const phone = String(b.phone || '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Please enter your name');
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw httpError(400, 'Please enter your phone number');
    if (!(await bp.available(c.tenantId))) throw httpError(503, 'Online payment is not available right now. Please try later.');
    // the same guest asking again for the very same table, time and group (a second tap, a second phone): he gets his own held booking back, not a second one
    const mineHeld = await TableBooking.findOne({ tenantId: c.tenantId, userId: req.auth.userId, status: 'held', date: b.date, time: b.time, table: String(b.table), party: Math.round(Number(b.party)), holdUntil: { $gt: new Date() } });
    if (mineHeld) return res.json({ booking: mineHeld.toObject(), pay: await bp.start(mineHeld) });
    // a guest holds a table for one unpaid booking at a time: starting a new one lets the older unpaid one go (no blocking a slot without paying)
    for (const old of await TableBooking.find({ tenantId: c.tenantId, userId: req.auth.userId, status: 'held' })) await bp.cancelBooking(old, 'customer');
    const booking = await tb.book({ config: c, userId: req.auth.userId, name, phone, date: b.date, time: b.time, party: b.party, table: b.table, note: b.note });
    wl.markBooked(c.tenantId, req.auth.userId, b.date, b.time).catch(() => { });   // he is no longer waiting for this slot
    try {
        const pay = await bp.start(booking);
        res.status(201).json({ booking: (await TableBooking.findById(booking._id)).toObject(), pay });
    } catch (e) {
        await bp.cancelBooking(booking, 'customer');   // no payment could be started: give the seats back
        throw e;
    }
}));

router.post('/:id/pay', wrap(async (req, res) => {
    const b = await mineBooking(req);
    res.json({ booking: b.toObject(), pay: await bp.start(b) });
}));
router.post('/:id/verify', wrap(async (req, res) => {
    const b = await mineBooking(req);
    const x = req.body || {};
    const [rzpOrderId, rzpPaymentId, signature] = [x.razorpay_order_id, x.razorpay_payment_id, x.razorpay_signature];
    if (![rzpOrderId, rzpPaymentId, signature].every((v) => typeof v === 'string' && v && v.length <= 100)) throw httpError(400, 'Payment details are missing');
    const r = await bp.verify({ booking: b, rzpOrderId, rzpPaymentId, signature });
    res.json({ paid: !!r.paid, booking: (await TableBooking.findById(b._id)).toObject() });
}));
router.post('/:id/check', wrap(async (req, res) => {
    const b = await mineBooking(req);
    let r;
    try { r = await bp.check(b); } catch (e) { r = { paid: false, status: 'unknown' }; }
    res.json({ ...r, booking: (await TableBooking.findById(b._id)).toObject() });
}));

// The table card the app keeps on screen: the booking the owner allowed, from then until its slot is over
router.get('/card', wrap(async (req, res) => {
    const now = new Date();
    const b = await TableBooking.findOne({
        tenantId: req.tenant._id, userId: req.auth.userId, status: 'confirmed', approvedAt: { $exists: true },
        $or: [{ endsAt: { $gt: now } }, { endsAt: { $exists: false }, startsAt: { $gt: new Date(now.getTime() - 60 * 60000) } }],
    }).sort({ startsAt: 1 }).lean();
    res.json({ card: b ? { id: String(b._id), code: b.code, table: b.table || null, date: b.date, time: b.time, party: b.party, startsAt: b.startsAt, endsAt: b.endsAt || new Date(b.startsAt.getTime() + 60 * 60000) } : null });
}));

// The receipt of the deposit (PDF)
router.get('/:id/receipt', wrap(async (req, res) => {
    const b = await mineBooking(req);
    require('../services/bookingReceipt').stream(res, b.toObject(), await require('../models/Tenant').findById(b.tenantId).lean());
}));

router.get('/mine', wrap(async (req, res) => {
    const items = await TableBooking.find({ tenantId: req.tenant._id, userId: req.auth.userId, status: { $ne: 'expired' } }).sort({ startsAt: -1 }).limit(50).lean();
    res.json({ items });
}));

router.post('/:id/cancel', wrap(async (req, res) => {
    const b = await mineBooking(req);
    if (b.startsAt.getTime() < Date.now()) throw httpError(400, 'This booking time has passed');
    const done = await bp.cancelBooking(b, 'customer');
    if (!done) throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    if (b.status === 'confirmed') tell('booking_cancelled', { tenantId: done.tenantId, vars: { name: done.name, party: done.party, date: done.date, time: done.time }, data: { kind: 'booking', bookingId: String(done._id) } });
    res.json(done);
}));

router.use(apiErrors);   // the real message for an expected error ("that table was just taken"), not "Something went wrong"
module.exports = router;
