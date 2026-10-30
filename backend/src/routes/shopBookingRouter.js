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
