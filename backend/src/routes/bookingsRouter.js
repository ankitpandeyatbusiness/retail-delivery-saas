// What a customer sees and does for table booking. Mounted at /api/bookings.
//   GET /config                       { enabled, minParty, maxParty, advanceDays, today, deposit: { type, amount, mode, refundHours } }
//   GET /slots?date=YYYY-MM-DD&party=4  { date, slots: [{ time, left, ok }], deposit }
//   POST /                            { date, time, party, name, phone, note? }
//   GET /mine      POST /:id/cancel
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const TableBooking = require('../models/TableBooking');
const User = require('../models/User');
const tb = require('../services/tableBooking');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const rules = (c) => ({ type: c.depositType, amount: c.depositAmount, mode: c.depositMode, refundHours: c.refundHours });

const on = async (req) => {
    const c = await tb.getConfig(req.tenant._id);
    if (!c.enabled) throw httpError(404, 'Table booking is not available at this shop');
    return c;
};

router.get('/config', wrap(async (req, res) => {
    const c = await tb.getConfig(req.tenant._id);
    const me = c.enabled ? await User.findById(req.auth.userId).select('name phone').lean() : null;
    res.json({ enabled: !!c.enabled, minParty: c.minParty, maxParty: c.maxParty, advanceDays: c.advanceDays, today: tb.todayYmd(), deposit: rules(c), me: { name: me?.name || '', phone: me?.phone || '' } });
}));

router.get('/slots', wrap(async (req, res) => {
    const c = await on(req);
    const party = Math.round(Number(req.query.party)) || c.minParty;
    res.json({ date: req.query.date, slots: await tb.availability(c, req.query.date, party), deposit: tb.depositFor(c, party) });
}));

router.post('/', wrap(async (req, res) => {
    const c = await on(req);
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const phone = String(b.phone || '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Please enter your name');
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw httpError(400, 'Please enter your phone number');
    const booking = await tb.book({ config: c, userId: req.auth.userId, name, phone, date: b.date, time: b.time, party: b.party, note: b.note });
    tell('booking_new', { tenantId: c.tenantId, vars: { name, party: booking.party, date: booking.date, time: booking.time }, data: { kind: 'booking', bookingId: String(booking._id) } });
    res.status(201).json(booking.toObject());
}));

router.get('/mine', wrap(async (req, res) => {
    const items = await TableBooking.find({ tenantId: req.tenant._id, userId: req.auth.userId }).sort({ startsAt: -1 }).limit(50).lean();
    res.json({ items });
}));

router.post('/:id/cancel', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Booking not found');
    const b = await TableBooking.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!b) throw httpError(404, 'Booking not found');
    if (b.startsAt.getTime() < Date.now()) throw httpError(400, 'This booking time has passed');
    const done = await tb.cancel(b, 'customer');
    if (!done) throw httpError(400, 'This booking is already ' + b.status.replace('_', ' '));
    tell('booking_cancelled', { tenantId: done.tenantId, vars: { name: done.name, party: done.party, date: done.date, time: done.time }, data: { kind: 'booking', bookingId: String(done._id) } });
    res.json(done.toObject());
}));

module.exports = router;
