// Superadmin: profit and loss, who owes money, and your own expenses. Mounted under /api/admin.
//   GET    /finance/summary?months=6|12   monthly profit and loss + reasons
//   GET    /finance/receivables           unpaid rent: aging, per shop, who pays late
//   GET    /finance/expenses              list (newest first)
//   POST   /finance/expenses              add
//   PATCH  /finance/expenses/:id          change
//   DELETE /finance/expenses/:id          remove
const express = require('express');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const finance = require('../services/financeService');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/finance/summary', wrap(async (req, res) => {
    const months = Number(req.query.months) === 12 ? 12 : Number(req.query.months) === 3 ? 3 : 6;
    res.json(await finance.summary({ months }));
}));

router.get('/finance/receivables', wrap(async (req, res) => {
    res.json(await finance.receivables());
}));

const view = (e) => ({
    id: e._id, date: e.date, category: e.category, amountPaise: e.amountPaise, vendor: e.vendor || '', note: e.note || '',
    repeatMonthly: !!e.repeatMonthly, endsOn: e.endsOn || null,
});

function clean(body, partial) {
    const out = {};
    if (!partial || body.date !== undefined) {
        const d = new Date(body.date);
        if (!body.date || Number.isNaN(d.getTime())) throw httpError(400, 'Date is required');
        out.date = d;
    }
    if (!partial || body.category !== undefined) {
        if (!Expense.CATEGORIES.includes(body.category)) throw httpError(400, 'Pick a category');
        out.category = body.category;
    }
    if (!partial || body.amountPaise !== undefined) {
        const n = Number(body.amountPaise);
        if (!Number.isInteger(n) || n < 1 || n > 100000000) throw httpError(400, 'Amount must be a whole number of paise above 0');
        out.amountPaise = n;
    }
    if (body.vendor !== undefined) out.vendor = String(body.vendor || '').slice(0, 80);
    if (body.note !== undefined) out.note = String(body.note || '').slice(0, 200);
    if (body.repeatMonthly !== undefined) out.repeatMonthly = !!body.repeatMonthly;
    if (body.endsOn !== undefined) {
        if (body.endsOn === null || body.endsOn === '') out.endsOn = null;
        else {
            const d = new Date(body.endsOn);
            if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid end date');
            out.endsOn = d;
        }
    }
    return out;
}

router.get('/finance/expenses', wrap(async (req, res) => {
    const items = await Expense.find({}).sort({ date: -1 }).limit(500).lean();
    res.json({ items: items.map(view), categories: Expense.CATEGORIES });
}));

router.post('/finance/expenses', wrap(async (req, res) => {
    const e = await Expense.create({ ...clean(req.body || {}, false), createdBy: req.admin?.email || req.admin?.phone || 'superadmin' });
    res.status(201).json(view(e));
}));

const oid = (req) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Expense not found');
    return req.params.id;
};

router.patch('/finance/expenses/:id', wrap(async (req, res) => {
    const e = await Expense.findByIdAndUpdate(oid(req), { $set: clean(req.body || {}, true) }, { returnDocument: 'after', runValidators: true });
    if (!e) throw httpError(404, 'Expense not found');
    res.json(view(e));
}));

router.delete('/finance/expenses/:id', wrap(async (req, res) => {
    const e = await Expense.findByIdAndDelete(oid(req));
    if (!e) throw httpError(404, 'Expense not found');
    res.json({ ok: true });
}));

module.exports = router;
