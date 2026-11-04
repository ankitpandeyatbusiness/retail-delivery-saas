// Superadmin: the Export centre. Mounted under /api/admin.
//   GET /exports/catalog                what can be exported, its filters and what each detail level holds
//   GET /exports/:key/count             how many rows the choice gives, before you download
//   GET /exports/:key/download          the file. ?format=xlsx|csv  &level=quick|standard|everything  &shops=id,id  &brandId=  &from=2026-11-01  &to=2026-11-30  &full=1
//                                       plus the filters of that export (status=..., type=...)
// Full phone numbers (full=1): the supreme admin only. Every download is written to the audit log.
const express = require('express');
const centre = require('../services/exportCentre');
const AuditLog = require('../models/AuditLog');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { isSupreme } = require('../config/supreme');
const { XLSX_TYPE } = require('../services/xlsxExport');

const router = express.Router();

function fullPhones(req) {
    if (req.query.full !== '1') return false;
    if (!isSupreme(req.admin)) throw httpError(403, 'Only the supreme admin can export full phone numbers');
    return true;
}
const writeDown = (req, key, full, rows) => AuditLog.create({
    actorType: 'superadmin', actorId: req.admin?._id, actorLabel: req.admin?.email, action: `${full ? 'EXPORT WITH FULL PHONES' : 'EXPORT'} ${key}`,
    method: req.method, path: req.originalUrl.split('?')[0], query: { ...req.query, rows }, ip: req.ip,
}).catch((e) => console.error('Audit log error:', e.message));

router.get('/exports/catalog', wrap(async (req, res) => { res.json({ items: centre.catalog(), max: centre.MAX_ROWS, csvMax: centre.CSV_MAX, canSeeFullPhones: isSupreme(req.admin) }); }));

router.get('/exports/:key/count', wrap(async (req, res) => { res.json(await centre.count(req.params.key, req.query)); }));

router.get('/exports/:key/download', wrap(async (req, res) => {
    const full = fullPhones(req);
    const key = req.params.key;
    const stamp = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    if (req.query.format === 'csv') {
        const r = await centre.csv(key, req.query, { full });
        writeDown(req, key, full, r.rows);
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${key}-${stamp}.csv"`);
        return res.send(r.text);
    }
    const r = await centre.workbook(key, req.query, { full, admin: req.admin?.name || req.admin?.email });
    writeDown(req, key, full, r.rows);
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="${key}-${stamp}.xlsx"`);
    return res.send(r.buf);
}));

module.exports = router;
