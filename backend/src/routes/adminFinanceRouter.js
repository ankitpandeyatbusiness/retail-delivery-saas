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

// the Money tab's "Needs attention": overdue bills, shops to close, failed refunds and Razorpay events, money that does not add up, low SMS wallets
router.get('/finance/attention', wrap(async (req, res) => { res.json(await require('../services/moneyAttention').attention()); }));

// one month closed: this month against last, GST, what is owed (?month=2026-11, default this month)
router.get('/finance/month', wrap(async (req, res) => { res.json(await require('../services/monthClose').summary(req.query.month || undefined)); }));
// the next 30 days: rent due soon, overdue (not counted), the next bills and the costs, as estimates
router.get('/finance/next30', wrap(async (req, res) => { res.json(await require('../services/monthClose').next30()); }));
// everything the CA needs for the month in one Excel: summary, bills, SMS top-ups, GST register, expenses
router.get('/finance/month/export', wrap(async (req, res) => {
    const mc = require('../services/monthClose');
    const month = req.query.month || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const buf = await mc.workbook(month);
    res.set('Content-Type', require('../services/xlsxExport').XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="month-close-${month}.xlsx"`);
    res.send(buf);
}));

// notes and promises about a shop's unpaid rent ("will pay on Friday"); a new one replaces the open one
router.get('/finance/receivables/:tenantId/notes', wrap(async (req, res) => { res.json({ items: await require('../services/collectionNotes').listFor(req.params.tenantId) }); }));
router.post('/finance/receivables/:tenantId/note', wrap(async (req, res) => {
    const n = await require('../services/collectionNotes').add({ tenantId: req.params.tenantId, note: req.body?.note, promiseDate: req.body?.promiseDate, by: req.admin?.email });
    req.auditBefore = null;
    res.json(require('../services/collectionNotes').view(n));
}));
router.patch('/finance/notes/:id', wrap(async (req, res) => { res.json(require('../services/collectionNotes').view(await require('../services/collectionNotes').close(req.params.id, req.body?.outcome))); }));

router.get('/finance/receivables', wrap(async (req, res) => {
    res.json(await finance.receivables());
}));

// shops whose rent is unpaid for months: the list to decide on closing from
router.get('/finance/to-close', wrap(async (req, res) => { res.json(await require('../services/shopClosure').toClose()); }));

// Remind: a push to the owner of one shop, or to every branch of a brand that owes rent
router.post('/finance/receivables/brand/:brandId/remind', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.brandId)) throw httpError(400, 'Invalid brand');
    res.json(await require('../services/rentReminder').remindBrand(req.params.brandId));
}));
router.post('/finance/receivables/:tenantId/remind', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tenantId)) throw httpError(400, 'Invalid shop');
    res.json(await require('../services/rentReminder').remindShop(req.params.tenantId));
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
