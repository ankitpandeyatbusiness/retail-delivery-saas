// The common settlement sheet between the two partners. Mounted inside adminRouter.
// Every superadmin can READ it and add an "I have paid" note; only the supreme admin changes anything else (middlewares/supremeAdmin.js).
//   GET  /settlement/summary?month=2026-10            what each owes, late rows, the net
//   GET  /settlement/entries?status=open|late|paid|pending|partial&kind=&month=&tenantId=&page=
//   GET  /settlement/entries/:id                      one row with its whole timeline
//   GET  /settlement/export?month=2026-10             Excel (month optional)
//   GET  /settlement/config                           names, the 15-day rule, the ratios
//   PUT  /settlement/config                           (supreme)  { ownerName, partnerName, payDays, ownerPctPartnerBrought, ownerPctOwnerBrought, costOwnerPct, mode }
//   POST /settlement/costs                            (supreme)  { category, title, amount, paidBy, date, note }  a shared cost, split 50/50
//   POST /settlement/adjustments                      (supreme)  { owes, amount, reason, date }
//   POST /settlement/entries/:id/paid                 (supreme)  { amount, date, ref, note }  money moved
//   POST /settlement/entries/:id/claim                (anyone)   { amount, date, ref, note }  "I have paid" (a note until confirmed)
//   POST /settlement/entries/:id/claim/confirm        (supreme)
//   POST /settlement/entries/:id/claim/reject         (supreme)  { note }
//   POST /settlement/setoff                           (supreme)  { fromPartnerId, fromOwnerId, amount, reason }
//   PUT  /settlement/shops/:tid/brought-by            (supreme)  { broughtBy: "owner" | "partner" }
const express = require('express');
const settlement = require('../services/settlement');
const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

router.get('/settlement/summary', wrap(async (req, res) => { res.json(await settlement.summary({ month: req.query.month })); }));

router.get('/settlement/config', wrap(async (req, res) => { res.json(await settlement.getConfig()); }));

router.get('/settlement/entries', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 30, 1, 100);
    res.json(await settlement.list({ status: req.query.status, kind: req.query.kind, month: req.query.month, tenantId: req.query.tenantId }, { page, limit }));
}));

router.get('/settlement/entries/:id', wrap(async (req, res) => { res.json(await settlement.one(req.params.id)); }));

router.get('/settlement/export', wrap(async (req, res) => {
    const cfg = await settlement.getConfig();
    const { items } = await settlement.list({ month: req.query.month }, { page: 1, limit: 5000 });
    const name = (side) => (side === 'owner' ? cfg.ownerName : side === 'partner' ? cfg.partnerName : '');
    const buf = await buildSheet({
        title: `Settlement sheet${req.query.month ? ` ${req.query.month}` : ''}`,
        subtitle: `${cfg.partnerName} pays ${cfg.ownerName} within ${cfg.payDays} days of each payment  ·  shares are on the amount before GST  ·  numbers only, the money moves outside the app`,
        total: true,
        columns: [
            { header: '#', key: 'no', kind: 'int' },
            { header: 'Date', key: 'date', kind: 'date' },
            { header: 'Kind', key: 'kind' },
            { header: 'What', key: 'title', kind: 'wide' },
            { header: 'Shop', key: 'shop' },
            { header: 'Brought by', key: 'broughtBy' },
            { header: 'Amount before GST / cost', key: 'base', kind: 'money' },
            { header: `${cfg.ownerName} share`, key: 'ownerShare', kind: 'money' },
            { header: `${cfg.partnerName} share`, key: 'partnerShare', kind: 'money' },
            { header: 'Who pays', key: 'owes' },
            { header: 'To pay', key: 'dueAmount', kind: 'money' },
            { header: 'Paid', key: 'paidAmount', kind: 'money' },
            { header: 'Left', key: 'remaining', kind: 'money' },
            { header: 'Due by', key: 'dueAt', kind: 'date' },
            { header: 'Status', key: 'status', kind: 'status' },
        ],
        rows: items.map((r) => ({
            no: r.no, date: r.date, kind: r.kind === 'receipt' ? 'Shop payment' : r.kind === 'cost' ? 'Shared cost' : 'Adjustment', title: r.title, shop: r.shopName || '',
            broughtBy: name(r.broughtBy), base: r.kind === 'receipt' ? r.baseAmount : r.amount, ownerShare: r.ownerShare || 0, partnerShare: r.partnerShare || 0,
            owes: name(r.owes), dueAmount: r.dueAmount, paidAmount: r.paidAmount, remaining: r.remaining, dueAt: r.dueAt, status: r.late ? 'late' : r.status,
        })),
    });
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="settlement${req.query.month ? `-${req.query.month}` : ''}.xlsx"`);
    res.send(buf);
}));

router.put('/settlement/config', wrap(async (req, res) => { res.json(await settlement.saveConfig(req.body || {})); }));
router.post('/settlement/costs', wrap(async (req, res) => { res.status(201).json(await settlement.addCost(req.body || {}, req.admin)); }));
router.post('/settlement/adjustments', wrap(async (req, res) => { res.status(201).json(await settlement.addAdjustment(req.body || {}, req.admin)); }));
router.post('/settlement/entries/:id/paid', wrap(async (req, res) => { res.json(await settlement.markPaid(req.params.id, req.body || {}, req.admin)); }));
router.post('/settlement/entries/:id/claim', wrap(async (req, res) => { res.json(await settlement.claim(req.params.id, req.body || {}, req.admin)); }));
router.post('/settlement/entries/:id/claim/confirm', wrap(async (req, res) => { res.json(await settlement.confirmClaim(req.params.id, req.admin)); }));
router.post('/settlement/entries/:id/claim/reject', wrap(async (req, res) => { res.json(await settlement.rejectClaim(req.params.id, req.body?.note, req.admin)); }));
router.post('/settlement/setoff', wrap(async (req, res) => { res.json(await settlement.setOff(req.body || {}, req.admin)); }));
router.put('/settlement/shops/:tid/brought-by', wrap(async (req, res) => {
    if (!/^[0-9a-f]{24}$/.test(req.params.tid)) throw httpError(404, 'Shop not found');
    res.json(await settlement.setBroughtBy(req.params.tid, req.body?.broughtBy, req.admin));
}));

router.use(apiErrors);
module.exports = router;
