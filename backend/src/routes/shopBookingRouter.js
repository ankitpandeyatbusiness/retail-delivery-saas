// The owner's table booking. Mounted under /api/shop/booking.
//   GET /settings    PUT /settings { any of the rules }       (the on/off slider sends only { enabled })
//   GET /?date=YYYY-MM-DD   the day's bookings with seats taken per slot   { date, items, seats, upcoming }
//   POST /:id/seat   POST /:id/no-show   POST /:id/cancel
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const TableBookingConfig = require('../models/TableBookingConfig');
const TableBooking = require('../models/TableBooking');
const tb = require('../services/tableBooking');
const bp = require('../services/bookingPayment');
const ticket = require('../services/bookingTicket');
const featureGate = require('../services/featureGate');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

// dineTableCount: how many tables the shop has for dine in (the settings screen offers to fill the table list from it)
router.get('/settings', wrap(async (req, res) => { res.json({ ...(await tb.getConfig(req.tenant._id)), dineTableCount: require('../services/tableQr').tableCount(req.tenant) || 0, featureOn: featureGate.isOn(req.tenant, 'tableBooking') }); }));

router.put('/settings', wrap(async (req, res) => {
    // the switch comes first: a shop without it cannot even try to turn booking on
    if (req.body?.enabled === true && req.actor?.type !== 'superadmin' && !featureGate.isOn(req.tenant, 'tableBooking')) throw httpError(403, 'Table booking is not switched on for your shop. Ask us to switch it on.');
    const current = await tb.getConfig(req.tenant._id);
    const changes = tb.cleanConfig(req.body, current);
    if (changes.enabled && !(await bp.available(req.tenant._id))) throw httpError(400, 'Table booking needs online payments. Ask us to connect your Razorpay account first.');
    await TableBookingConfig.updateOne({ tenantId: req.tenant._id }, { $set: changes, $setOnInsert: { tenantId: req.tenant._id } }, { upsert: true });
    res.json({ ...(await tb.getConfig(req.tenant._id)), dineTableCount: require('../services/tableQr').tableCount(req.tenant) || 0, featureOn: featureGate.isOn(req.tenant, 'tableBooking') });
}));


// The door scanner: the QR (or the typed code) of a guest. /scan only looks; /scan/arrive marks him arrived (seated).
router.post('/scan', wrap(async (req, res) => { res.json(await ticket.check(req.tenant, req.body?.token || req.body?.code)); }));
router.post('/scan/arrive', wrap(async (req, res) => { res.json(await ticket.arrive(req.tenant, req.body?.token || req.body?.code, { type: 'owner', name: 'Owner' })); }));
// every booking, newest day first, for a range of days: ?all=1&from=YYYY-MM-DD&to=YYYY-MM-DD&status=confirmed (all optional, at most 300)
router.get('/', wrap(async (req, res, next) => {
    if (!req.query.all) return next();
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
    const from = day(req.query.from); const to = day(req.query.to);
    const q = { tenantId: req.tenant._id, status: { $nin: ['held', 'expired'] } };
    if (from || to) q.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (req.query.status && ['confirmed', 'seated', 'no_show', 'cancelled'].includes(req.query.status)) q.status = req.query.status;
    const dir = req.query.sort === 'oldest' ? 1 : -1;
    const items = await TableBooking.find(q).sort({ date: dir, time: 1, createdAt: 1 }).limit(300).lean();
    res.json({ all: true, items, truncated: items.length === 300 });
}));

router.get('/', wrap(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : tb.todayYmd();
    const tenantId = req.tenant._id;
    const [items, upcoming, waiting] = await Promise.all([
        TableBooking.find({ tenantId, date, status: { $nin: ['held', 'expired'] } }).sort({ time: 1, createdAt: 1 }).lean(),
        TableBooking.countDocuments({ tenantId, status: 'confirmed', date: { $gte: tb.todayYmd() } }),
        require('../models/WaitlistEntry').countDocuments({ tenantId, date, status: 'waiting' }),   // guests waiting for a table that day
    ]);
    const seats = items.filter((b) => tb.LIVE.includes(b.status)).reduce((n, b) => n + b.party, 0);
    res.json({ date, items, seats, upcoming, waiting });
}));

const mine = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Booking not found');
    const b = await TableBooking.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!b) throw httpError(404, 'Booking not found');
    return b;
};

const move = (to, then) => wrap(async (req, res) => {
    const b = await mine(req);
    if (b.status !== 'confirmed') throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    if (!b.approvedAt) throw httpError(400, 'Allow this booking first');
    if (Date.now() < new Date(b.startsAt).getTime()) throw httpError(400, 'Too early. You can mark a guest seated or no-show once the booking time has started');
    b.status = to;
    await b.save();
    await then(b);   // what happens to the deposit
    res.json((await TableBooking.findById(b._id)).toObject());
});
router.post('/:id/seat', move('seated', bp.seated));
router.post('/:id/no-show', move('no_show', bp.noShow));

router.get('/:id/receipt', wrap(async (req, res) => {
    const b = await mine(req);
    require('../services/bookingReceipt').stream(res, b.toObject(), await require('../models/Tenant').findById(b.tenantId).lean());
}));
router.get('/:id', wrap(async (req, res) => { res.json((await mine(req)).toObject()); }));

// Take back the last change of a booking: Allow, Seated or No-show. (Deny and Cancel cannot be taken back: the guest already has the refund.)
router.post('/:id/undo', wrap(async (req, res) => {
    const b = await mine(req);
    const id = b._id;
    if (b.status === 'seated') {
        if (b.freedAt) throw httpError(400, 'The table was already freed for other guests, so this cannot be undone');
        if (b.deposit?.status === 'adjusted') throw httpError(400, 'The deposit was already taken off the bill, so this cannot be undone');
        await TableBooking.updateOne({ _id: id, status: 'seated' }, { $set: { status: 'confirmed' }, $unset: { arrivedAt: 1, arrivedBy: 1, 'deposit.credit': 1 } });
        await TableBooking.updateOne({ _id: id, 'deposit.status': 'kept' }, { $set: { 'deposit.status': 'paid' } });   // keep mode: the shop had kept it when the guest sat
    } else if (b.status === 'no_show') {
        const clash = await TableBooking.findOne({ _id: { $ne: id }, tenantId: b.tenantId, date: b.date, table: b.table, status: { $in: tb.LIVE }, startsAt: { $lt: b.endsAt }, endsAt: { $gt: b.startsAt } }).select('_id').lean();
        if (b.table && clash) throw httpError(400, 'Another guest has booked this table for that time since, so this cannot be undone');
        await TableBooking.updateOne({ _id: id, status: 'no_show' }, { $set: { status: 'confirmed' } });
        await TableBooking.updateOne({ _id: id, 'deposit.status': 'kept' }, { $set: { 'deposit.status': 'paid' } });
    } else if (b.status === 'confirmed' && b.approvedAt) {
        await TableBooking.updateOne({ _id: id, status: 'confirmed' }, { $unset: { approvedAt: 1 } });   // the guest's ticket goes until it is allowed again
    } else throw httpError(400, 'There is nothing to undo for this booking');
    res.json((await TableBooking.findById(id)).toObject());
}));

// The guest has left (or the table is free for another reason): the rest of the slot can be booked by others
router.post('/:id/free', wrap(async (req, res) => {
    const b = await mine(req);
    const done = await tb.freeTable(b);
    if (!done) throw httpError(400, 'This table is not held by a seated guest');
    res.json(done.toObject());
}));

// The owner allows a booking: the guest is told it is confirmed
router.post('/:id/allow', wrap(async (req, res) => {
    const b = await mine(req);
    const done = await bp.allow({ _id: b._id, shopName: req.tenant.name });
    if (!done) throw httpError(400, 'This booking cannot be allowed (it is already allowed, cancelled or past)');
    res.json(done.toObject());
}));

// "I took the deposit off this table's bill"
router.post('/:id/adjusted', wrap(async (req, res) => {
    const b = await mine(req);
    const r = await bp.adjusted(b);
    if (!r.modifiedCount) throw httpError(400, 'There is no deposit waiting to be taken off a bill for this booking');
    res.json((await TableBooking.findById(b._id)).toObject());
}));

router.post('/:id/cancel', wrap(async (req, res) => {
    const b = await mine(req);
    const message = String(req.body?.message || '').trim().slice(0, 300);
    const done = await bp.cancelBooking(b, 'owner', { message });
    if (!done) throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    const refund = ['refunding', 'refunded', 'refund_failed'].includes(done.deposit.status);
    tell('booking_owner_cancelled', { tenantId: done.tenantId, userId: done.userId, vars: { shop: req.tenant.name, date: done.date, time: done.time, message, refund, amount: done.deposit.amount }, data: { kind: 'booking', bookingId: String(done._id) } });
    res.json(done);
}));

module.exports = router;
