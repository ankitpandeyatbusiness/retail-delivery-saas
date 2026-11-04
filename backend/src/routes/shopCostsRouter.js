// The shop owner's costs and profit. Mounted at /api/shop/costs (the shop's owner only).
//   GET    /            ?from=2026-11-01&to=2026-11-30&category=   the costs written down, newest first, with the total of the list
//   POST   /            { date, category, amountPaise, otherName?, vendor?, note?, repeatMonthly?, endsOn? }
//   PATCH  /:id         change one
//   DELETE /:id         remove one
//   GET    /profit      ?from=&to=   sales, costs, rent and SMS paid to the platform, profit, and the same for the period before
const express = require('express');
const mongoose = require('mongoose');
const ShopExpense = require('../models/ShopExpense');
const profit = require('../services/shopProfit');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const view = (e) => ({ id: String(e._id), date: e.date, category: e.category, label: profit.LABEL[e.category] || e.category, otherName: e.otherName || '', amountPaise: e.amountPaise, vendor: e.vendor || '', note: e.note || '', repeatMonthly: !!e.repeatMonthly, endsOn: e.endsOn || null });

function clean(body, partial) {
    const out = {};
    if (!partial || body.date !== undefined) {
        const d = new Date(body.date);
        if (!body.date || Number.isNaN(d.getTime())) throw httpError(400, 'Date is needed');
        out.date = d;
    }
    if (!partial || body.category !== undefined) {
        if (!ShopExpense.CATEGORIES.includes(body.category)) throw httpError(400, 'Pick what the cost is for');
        out.category = body.category;
    }
    if (!partial || body.amountPaise !== undefined) {
        const n = Number(body.amountPaise);
        if (!Number.isInteger(n) || n < 1 || n > 1000000000) throw httpError(400, 'The amount must be more than zero');
        out.amountPaise = n;
    }
    if (body.otherName !== undefined) out.otherName = String(body.otherName || '').trim().slice(0, 60);
    if ((out.category || body.category) === 'other' && !partial && !String(body.otherName || '').trim()) throw httpError(400, 'Write what this cost is');
    if (body.vendor !== undefined) out.vendor = String(body.vendor || '').slice(0, 80);
    if (body.note !== undefined) out.note = String(body.note || '').slice(0, 200);
    if (body.repeatMonthly !== undefined) out.repeatMonthly = !!body.repeatMonthly;
    if (body.endsOn !== undefined) {
        if (body.endsOn === null || body.endsOn === '') out.endsOn = null;
        else { const d = new Date(body.endsOn); if (Number.isNaN(d.getTime())) throw httpError(400, 'The end date is not valid'); out.endsOn = d; }
    }
    return out;
}

router.get('/profit', wrap(async (req, res) => {
    res.json(await profit.build({ tenantId: req.tenant._id, from: req.query.from, to: req.query.to }));
}));

router.get('/', wrap(async (req, res) => {
    const m = { tenantId: req.tenant._id };
    if (ShopExpense.CATEGORIES.includes(req.query.category)) m.category = req.query.category;
    const f = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? new Date(`${req.query.from}T00:00:00+05:30`) : null;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? new Date(new Date(`${req.query.to}T00:00:00+05:30`).getTime() + 86400000) : null;
    if (f || t) m.date = { ...(f ? { $gte: f } : {}), ...(t ? { $lt: t } : {}) };
    const rows = await ShopExpense.find(m).sort({ date: -1, _id: -1 }).limit(300).lean();
    res.json({ items: rows.map(view), totalPaise: rows.filter((e) => !e.repeatMonthly).reduce((n, e) => n + e.amountPaise, 0), categories: ShopExpense.CATEGORIES.map((k) => ({ key: k, label: profit.LABEL[k] })) });
}));

router.post('/', wrap(async (req, res) => {
    const doc = await ShopExpense.create({ ...clean(req.body || {}, false), tenantId: req.tenant._id, createdBy: String(req.shopUser?.phone || '').slice(0, 20) });
    res.status(201).json(view(doc));
}));

router.patch('/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Not found');
    const e = await ShopExpense.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, { $set: clean(req.body || {}, true) }, { returnDocument: 'after' });
    if (!e) throw httpError(404, 'Not found');
    res.json(view(e));
}));

router.delete('/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Not found');
    const r = await ShopExpense.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!r.deletedCount) throw httpError(404, 'Not found');
    res.json({ ok: true });
}));

module.exports = router;
