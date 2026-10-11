// Superadmin: his push devices and the cost of his alert SMS. Mounted inside adminRouter.
//   POST /devices           { token, platform }   register this phone for push (call after login)
//   POST /devices/remove    { token }             call on logout
//   GET  /alerts/sms-cost   ?from=2026-10-01&to=2026-10-31
//        platform = alert SMS YOU paid (no shop could pay); shops = alert SMS charged to shops
const express = require('express');
const AdminDevice = require('../models/AdminDevice');
const PlatformSmsCost = require('../models/PlatformSmsCost');
const SmsTransaction = require('../models/SmsTransaction');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();

router.post('/devices', wrap(async (req, res) => {
    const { token, platform } = req.body || {};
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw httpError(400, 'Invalid device token');
    if (platform !== undefined && !['android', 'ios', 'web'].includes(platform)) throw httpError(400, 'Invalid platform');

    await AdminDevice.findOneAndUpdate(
        { token },
        { $set: { adminId: req.admin._id, ...(platform && { platform }), lastSeenAt: new Date() } },
        { upsert: true },
    );
    // keep the newest 10 phones
    const extra = await AdminDevice.find({ adminId: req.admin._id }).sort({ lastSeenAt: -1 }).skip(10).select('_id').lean();
    if (extra.length) await AdminDevice.deleteMany({ _id: { $in: extra.map((e) => e._id) } });
    res.status(201).json({ ok: true });
}));

router.post('/devices/remove', wrap(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string') throw httpError(400, 'Invalid device token');
    await AdminDevice.deleteOne({ token, adminId: req.admin._id });
    res.json({ ok: true });
}));

router.get('/alerts/sms-cost', wrap(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    const range = (field) => (from || to ? { [field]: { ...(from && { $gte: from }), ...(to && { $lte: to }) } } : {});

    const [items, charged] = await Promise.all([
        PlatformSmsCost.find(range('at')).sort({ at: -1 }).limit(200).lean(),
        SmsTransaction.aggregate([
            { $match: { type: { $in: ['debit', 'refund'] }, purpose: 'platform_alert', ...range('createdAt') } },
            {
                $group: {
                    _id: null,
                    count: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, 1, 0] } },
                    net: { $sum: '$amountPaise' },   // debits are negative, refunds positive
                }
            },
        ]),
    ]);
    res.json({
        platform: { count: items.length, costPaise: items.reduce((s, i) => s + i.costPaise, 0), items },
        shops: { count: charged[0]?.count || 0, chargedPaise: -(charged[0]?.net || 0) },
    });
}));

router.use(apiErrors);
module.exports = router;