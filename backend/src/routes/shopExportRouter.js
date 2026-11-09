// The owner's own Export screen: Excel or CSV files of HIS shop (or all his branches, for a brand owner). Mounted at /api/shop/exports.
//   GET /catalog                what he can export (customers, orders, riders, cooks and waiters, shops and branches, menu, complaints, rent bills)
//   GET /:key/count             how many rows the choice gives
//   GET /:key/download          the file. ?format=xlsx|csv &level=quick|standard|everything &shops=<shopId>,<shopId> (a brand owner: any of his branches) &from=&to=  + the export's filters
// The shops are always checked here: an owner gets his own shop, a brand owner the branches of his brand, never anything else.
// His own customers, riders and staff are his data, so phone numbers are full. Every download is written to the audit log.
const express = require('express');
const mongoose = require('mongoose');
const centre = require('../services/exportCentre');
const AuditLog = require('../models/AuditLog');
const Brand = require('../models/Brand');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { XLSX_TYPE } = require('../services/xlsxExport');
const { hasFeature } = require('../services/featureGate');

// Partner and Growth: money columns only, and the exports that are all about people (customers, riders, cooks and waiters, complaints, bulk) are Pro. Pro: everything.
const PEOPLE = ['customers', 'riders', 'staff', 'complaints', 'bulk_orders'];
const full = (req) => hasFeature(req.tenant, 'fullExports');
const qOf = (req) => (full(req) ? { ...req.query, moneyOnly: undefined } : { ...req.query, moneyOnly: '1' });

const router = express.Router();
const TITLE = { invoices: 'Rent bills', staff: 'Cooks and waiters' };
const HINT = { invoices: 'Your monthly rent bills from the platform, with GST and payment details.' };

// the shops this person may export: his own, plus the branches of his brand when he is a brand owner
async function allowed(req) {
    const own = req.tenant._id;
    let ids = [own];
    const phone = req.shopUser?.phone || (req.auth?.userId ? (await User.findById(req.auth.userId).select('phone').lean())?.phone : null);
    if (req.tenant.brandId && phone) {
        const brand = await Brand.findById(req.tenant.brandId).select('ownerPhones').lean();
        if (brand && (brand.ownerPhones || []).includes(phone)) ids = (await Tenant.find({ brandId: req.tenant.brandId }).select('_id').lean()).map((t) => t._id);
    }
    const shops = await Tenant.find({ _id: { $in: ids } }).sort({ createdAt: 1 }).select('name slug branchCity address.city').lean();
    return { ids, shops };
}
// the shops asked for, inside the allowed ones (none asked = all allowed)
function chosen(a, q) {
    if (!q.shops) return a.ids;
    const want = String(q.shops).split(',').filter(Boolean);
    if (want.some((x) => !mongoose.isValidObjectId(x))) throw httpError(400, 'A shop is not valid');
    const ok = new Set(a.ids.map(String));
    if (want.some((x) => !ok.has(String(x)))) throw httpError(403, 'That shop is not yours');
    return want.map((x) => new mongoose.Types.ObjectId(x));
}
function keyOf(req) {
    if (!centre.OWNER_KEYS.includes(req.params.key)) throw httpError(404, 'Unknown export');
    if (!full(req) && PEOPLE.includes(req.params.key)) throw httpError(403, 'This export has customer or staff details. It is in the Pro plan. See Plan to upgrade.');
    return req.params.key;
}
const writeDown = (req, key, rows) => AuditLog.create({
    actorType: 'owner', actorId: req.auth?.userId, tenantId: req.tenant._id, actorLabel: req.shopUser?.phone || 'shop owner', action: `EXPORT ${key}`,
    method: req.method, path: req.originalUrl.split('?')[0], query: { ...req.query, rows }, ip: req.ip,
}).catch((e) => console.error('Audit log error:', e.message));

router.get('/catalog', wrap(async (req, res) => {
    const a = await allowed(req);
    const items = centre.catalog({ keys: centre.OWNER_KEYS.filter((k) => full(req) || !PEOPLE.includes(k)), moneyOnly: !full(req) }).map((i) => ({ ...i, title: TITLE[i.key] || i.title, hint: HINT[i.key] || i.hint, shops: i.key === 'branches' ? false : i.shops && a.shops.length > 1 }));
    res.json({
        items, max: centre.MAX_ROWS, csvMax: centre.CSV_MAX,
        shops: a.shops.map((t) => ({ id: String(t._id), name: t.name, city: t.branchCity || (t.address && t.address.city) || '' })),
    });
}));

router.get('/:key/count', wrap(async (req, res) => {
    const key = keyOf(req);
    res.json(await centre.count(key, qOf(req), { full: true, forced: chosen(await allowed(req), req.query) }));
}));

router.get('/:key/download', wrap(async (req, res) => {
    const key = keyOf(req);
    const forced = chosen(await allowed(req), req.query);
    const stamp = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    if (req.query.format === 'csv') {
        const r = await centre.csv(key, qOf(req), { full: true, forced });
        writeDown(req, key, r.rows);
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${key}-${stamp}.csv"`);
        return res.send(r.text);
    }
    const r = await centre.workbook(key, qOf(req), { full: true, admin: req.shopUser?.name || 'Shop owner', forced });
    writeDown(req, key, r.rows);
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="${key}-${stamp}.xlsx"`);
    return res.send(r.buf);
}));

module.exports = router;
