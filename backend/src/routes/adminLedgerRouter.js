// Superadmin: every money movement in one place. Mounted under /api/admin.
//   GET /ledger                 what the platform received from all shops (SMS top-ups, monthly bills incl. pending)
//   GET /ledger/export          the same as a CSV file (up to 5000 rows)
//   GET /tenants/:tid/ledger    everything of ONE shop: what it got from customers, refunds, top-ups, bills
//   GET /tenants/:tid/ledger/export
// Filters: from, to (2026-10-31, Indian days), category, status (done|pending), tenantId (platform view), page, limit
const express = require('express');
const loadTenant = require('../middlewares/loadTenant');
const ledger = require('../services/moneyLedger');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
const EXPORT_MAX = 5000;

const handle = (view, csv) => wrap(async (req, res) => {
    const filter = ledger.parseQuery(req.query, { view });
    const tenantId = view === 'shop' ? req.tenantDoc._id : undefined;
    if (!csv) return res.json(await ledger.list({ view, tenantId, filter }));
    const r = await ledger.list({ view, tenantId, filter: { ...filter, page: 1, limit: 100 }, maxLimit: undefined });
    // the export walks the pages, so one request never loads everything at once
    let items = r.items;
    for (let p = 2; items.length < Math.min(r.total, EXPORT_MAX); p += 1) {
        const next = await ledger.list({ view, tenantId, filter: { ...filter, page: p, limit: 100 } });
        if (!next.items.length) break;
        items = items.concat(next.items);
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="transactions.csv"');
    return res.send(ledger.toCsv(items.slice(0, EXPORT_MAX), view));
});

router.get('/ledger', handle('platform', false));
router.get('/ledger/export', handle('platform', true));
router.get('/tenants/:tid/ledger', loadTenant, handle('shop', false));
router.get('/tenants/:tid/ledger/export', loadTenant, handle('shop', true));

module.exports = router;