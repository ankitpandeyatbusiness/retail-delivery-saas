// Superadmin SMS tools.
//   GET/PUT /platform/sms                  prices, packs, min/max
//   GET     /sms/profit?from=&to=          revenue - cost per shop
//   PUT     /tenants/:tid/sms/settings     per-shop price/cost/low/blockAtZero (null = platform default)
//   POST    /tenants/:tid/sms/credit       { amountPaise, note }
//   POST    /tenants/:tid/sms/debit        { amountPaise, note }
//   POST    /tenants/:tid/sms/topups/:id/mark-paid
// (The shop's own wallet screens also work for you at /tenants/:tid/shop/sms/...)

const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const loadTenant = require('../middlewares/loadTenant');
const PlatformSettings = require('../models/PlatformSettings');
const SmsWallet = require('../models/SmsWallet');
const SmsLog = require('../models/SmsLog');
const SmsTransaction = require('../models/SmsTransaction');
const Tenant = require('../models/Tenant');
const wallet = require('../services/smsWalletService');
const topups = require('../services/smsTopupService');

const { wrap, httpError } = apiErrors;
const router = express.Router();

const actorOf = (req) => ({
    type: 'superadmin', id: String(req.admin?._id || req.admin?.id || ''), label: req.admin?.email || 'superadmin',
});
const isInt = (v, min) => Number.isInteger(v) && v >= min;

/* ------------------------------ platform ------------------------------ */
router.get('/platform/sms', wrap(async (req, res) => {
    const p = await PlatformSettings.findById('main').select('sms').lean();
    res.json({ sms: { ...new PlatformSettings().toObject().sms, ...(p?.sms || {}) } });
}));

router.put('/platform/sms', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    for (const k of ['ratePerSmsPaise', 'costPerSmsPaise', 'lowBalancePaise']) {
        if (b[k] === undefined) continue;
        if (!isInt(b[k], 0)) throw httpError(400, `${k} must be a whole number of paise (0 or more)`);
        set[`sms.${k}`] = b[k];
    }
    for (const k of ['minTopupPaise', 'maxTopupPaise']) {
        if (b[k] === undefined) continue;
        if (!isInt(b[k], 100)) throw httpError(400, `${k} must be a whole number of paise (100 or more)`);
        set[`sms.${k}`] = b[k];
    }
    if (b.packs !== undefined) {
        if (!Array.isArray(b.packs) || b.packs.length < 1 || b.packs.length > 8 || !b.packs.every((n) => isInt(n, 100))) {
            throw httpError(400, 'packs must be 1 to 8 whole numbers of paise (100 or more)');
        }
        set['sms.packs'] = b.packs;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to update');

    const cur = (await PlatformSettings.findById('main').select('sms').lean())?.sms || {};
    const min = set['sms.minTopupPaise'] ?? cur.minTopupPaise ?? 10000;
    const max = set['sms.maxTopupPaise'] ?? cur.maxTopupPaise ?? 1000000;
    if (min > max) throw httpError(400, 'minTopupPaise cannot be above maxTopupPaise');

    req.auditBefore = cur;
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: set }, { upsert: true, setDefaultsOnInsert: true });
    wallet.refreshPlatform();
    const p = await PlatformSettings.findById('main').select('sms').lean();
    res.json({ sms: p.sms });
}));

/* ------------------------------ profit report ------------------------------ */
router.get('/sms/profit', wrap(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    const range = from || to ? { createdAt: { ...(from && { $gte: from }), ...(to && { $lte: to }) } } : {};

    const [sent, paid] = await Promise.all([
        SmsLog.aggregate([
            { $match: { status: { $in: ['sent', 'mock'] }, ...range } },
            { $group: { _id: '$tenantId', sms: { $sum: 1 }, revenuePaise: { $sum: '$chargedPaise' }, costPaise: { $sum: '$costPaise' } } },
        ]),
        SmsTransaction.aggregate([
            { $match: { type: 'topup', ...range } },
            { $group: { _id: '$tenantId', topupPaise: { $sum: '$amountPaise' } } },
        ]),
    ]);

    const rows = new Map();
    for (const r of sent) rows.set(String(r._id), { tenantId: r._id, sms: r.sms, revenuePaise: r.revenuePaise, costPaise: r.costPaise, topupPaise: 0 });
    for (const r of paid) {
        const row = rows.get(String(r._id)) || { tenantId: r._id, sms: 0, revenuePaise: 0, costPaise: 0, topupPaise: 0 };
        row.topupPaise = r.topupPaise;
        rows.set(String(r._id), row);
    }
    const names = await Tenant.find({ _id: { $in: [...rows.values()].map((r) => r.tenantId) } }).select('name slug').lean();
    const nameOf = new Map(names.map((t) => [String(t._id), t]));

    const items = [...rows.values()]
        .map((r) => ({ ...r, name: nameOf.get(String(r.tenantId))?.name, slug: nameOf.get(String(r.tenantId))?.slug, profitPaise: r.revenuePaise - r.costPaise }))
        .sort((a, b) => b.profitPaise - a.profitPaise);
    const sum = (k) => items.reduce((n, r) => n + r[k], 0);
    res.json({
        items,
        totals: { sms: sum('sms'), revenuePaise: sum('revenuePaise'), costPaise: sum('costPaise'), profitPaise: sum('profitPaise'), topupPaise: sum('topupPaise') },
    });
}));

/* ------------------------------ one shop ------------------------------ */
const sub = express.Router({ mergeParams: true });
router.use('/tenants/:tid/sms', loadTenant, sub);

sub.put('/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    for (const k of ['ratePerSmsPaise', 'costPerSmsPaise', 'lowBalancePaise']) {
        if (b[k] === undefined) continue;
        if (b[k] !== null && !isInt(b[k], 0)) throw httpError(400, `${k} must be a whole number of paise, or null for the platform default`);
        set[k] = b[k];
    }
    if (b.blockAtZero !== undefined) {
        if (typeof b.blockAtZero !== 'boolean') throw httpError(400, 'blockAtZero must be true or false');
        set.blockAtZero = b.blockAtZero;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to update');

    const w = await wallet.getWallet(req.tenantDoc._id);
    req.auditBefore = w.toObject();
    await SmsWallet.updateOne({ _id: w._id }, { $set: set });
    res.json(await wallet.status(req.tenantDoc._id));
}));

const noteOf = (b) => {
    const note = String(b?.note || '').trim().slice(0, 200);
    if (!note) throw httpError(400, 'A note (reason) is required');
    return note;
};

sub.post('/credit', wrap(async (req, res) => {
    const r = await wallet.credit({
        tenantId: req.tenantDoc._id, amountPaise: req.body?.amountPaise, type: 'adjust',
        note: noteOf(req.body), actor: actorOf(req),
    });
    res.status(201).json(r);
}));

sub.post('/debit', wrap(async (req, res) => {
    const r = await wallet.manualDebit({
        tenantId: req.tenantDoc._id, amountPaise: req.body?.amountPaise,
        note: noteOf(req.body), actor: actorOf(req),
    });
    res.status(201).json(r);
}));

// the owner paid but the webhook did not arrive (or Razorpay is not connected yet)
sub.post('/topups/:id/mark-paid', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Top-up not found');
    const r = await topups.complete({
        topupId: req.params.id, tenantId: req.tenantDoc._id,
        paymentId: typeof req.body?.paymentId === 'string' ? req.body.paymentId.slice(0, 80) : undefined,
        actor: actorOf(req),
    });
    res.json(r);
}));

module.exports = router;