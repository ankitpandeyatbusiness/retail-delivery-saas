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

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

router.get('/settings', wrap(async (req, res) => { res.json(await tb.getConfig(req.tenant._id)); }));

router.put('/settings', wrap(async (req, res) => {
    const current = await tb.getConfig(req.tenant._id);
    const changes = tb.cleanConfig(req.body, current);
    await TableBookingConfig.updateOne({ tenantId: req.tenant._id }, { $set: changes, $setOnInsert: { tenantId: req.tenant._id } }, { upsert: true });
    res.json(await tb.getConfig(req.tenant._id));
}));

router.get('/', wrap(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : tb.todayYmd();
    const tenantId = req.tenant._id;
    const [items, upcoming] = await Promise.all([
        TableBooking.find({ tenantId, date }).sort({ time: 1, createdAt: 1 }).lean(),
        TableBooking.countDocuments({ tenantId, status: 'confirmed', date: { $gte: tb.todayYmd() } }),
    ]);
    const seats = items.filter((b) => tb.LIVE.includes(b.status)).reduce((n, b) => n + b.party, 0);
    res.json({ date, items, seats, upcoming });
}));

const mine = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Booking not found');
    const b = await TableBooking.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!b) throw httpError(404, 'Booking not found');
    return b;
};

const move = (to) => wrap(async (req, res) => {
    const b = await mine(req);
    if (b.status !== 'confirmed') throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    b.status = to;
    await b.save();
    res.json(b.toObject());
});
router.post('/:id/seat', move('seated'));
router.post('/:id/no-show', move('no_show'));

router.post('/:id/cancel', wrap(async (req, res) => {
    const b = await mine(req);
    const done = await tb.cancel(b, 'owner');
    if (!done) throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    tell('booking_owner_cancelled', { tenantId: done.tenantId, userId: done.userId, vars: { shop: req.tenant.name, date: done.date, time: done.time }, data: { kind: 'booking', bookingId: String(done._id) } });
    res.json(done.toObject());
}));

module.exports = router;
