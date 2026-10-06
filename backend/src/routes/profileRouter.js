// The logged-in customer's own profile. Mounted at /api/me:
//
//   GET    /api/me        -> { id, phone, name, email }
//   PUT    /api/me        body { "name": "Ravi Kumar", "email": "ravi@example.com" }   (send either or both; email "" removes it)
//   DELETE /api/me        body { "confirm": true }   deletes the account (Play Store requires this)
//
// Deleting removes the profile, saved addresses, favourites and logins. Past orders stay with the shop
// (they hold their own copy of the name and phone), because the shop needs them for its tax records.

const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const Session = require('../models/Session');
const Address = require('../models/Address');
const Favourite = require('../models/Favourite');
const Order = require('../models/Order');
const { ACTIVE_STATUSES } = require('../services/orderflow');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const dto = (u) => ({ id: u._id, phone: u.phone, name: u.name || null, email: u.email || null });

router.get('/', wrap(async (req, res) => {
    const user = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).lean();
    if (!user) throw httpError(404, 'Account not found');
    res.json(dto(user));
}));

router.put('/', wrap(async (req, res) => {
    const set = {};
    const unset = {};

    if (req.body?.name !== undefined) {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (name.length < 2 || name.length > 80) throw httpError(400, 'Name must be 2 to 80 characters');
        set.name = name;
    }
    if (req.body?.email !== undefined) {
        const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : null;
        if (email === null) throw httpError(400, 'Invalid email');
        if (email === '') unset.email = '';
        else if (email.length > 120 || !EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address');
        else set.email = email;
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) throw httpError(400, 'Send name or email');

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    const user = await User.findOneAndUpdate(
        { _id: req.auth.userId, tenantId: req.tenant._id },
        update,
        { new: true, runValidators: true },
    ).lean();
    if (!user) throw httpError(404, 'Account not found');
    res.json(dto(user));
}));

router.delete('/', wrap(async (req, res) => {
    if (req.body?.confirm !== true) throw httpError(400, 'Send confirm: true to delete your account');

    const scope = { tenantId: req.tenant._id, userId: req.auth.userId };
    const user = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('role isBlocked').lean();
    if (!user) throw httpError(404, 'Account not found');
    // a blocked person must not be able to wipe the block by deleting and re-registering
    if (user.isBlocked) throw httpError(403, 'This account cannot be deleted');
    if (user.role === 'admin') throw httpError(403, 'Shop owner accounts cannot be deleted here. Please contact support.');

    const busy = await Order.exists({ ...scope, status: { $in: ACTIVE_STATUSES } });
    if (busy) throw httpError(409, 'You have an order in progress. You can delete your account after it is delivered or cancelled.');

    await Promise.all([
        Session.deleteMany({ userId: req.auth.userId }),
        Address.deleteMany(scope),
        Favourite.deleteMany(scope),
    ]);
    await User.deleteOne({ _id: req.auth.userId, tenantId: req.tenant._id });
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;