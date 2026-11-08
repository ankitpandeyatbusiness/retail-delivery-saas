// Superadmin: the customers of EVERY shop in one list, with what each one has done, and the same list as an Excel file.
// Mounted inside adminRouter (after requireSuperAdmin), so these URLs are:
//
//   GET /api/admin/customers          ?q=name or part of a phone  &tenantId=  &sort=spent|orders|last|cancels|joined  &page=1&limit=30  &full=1
//   GET /api/admin/customers/export   the same filters, as an Excel file (up to 5000 customers)
//
// Phone numbers are masked (98XXXXXX21). ONLY the supreme admin may ask for the full number (full=1); every such look or download is written to the audit log.
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { maskPhone } = require('../utils/phoneHash');
const { isSupreme } = require('../config/supreme');
const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');

const router = express.Router();
const EXPORT_MAX = 5000;
const SORTS = {
    spent: { spent: -1, orders: -1 },
    orders: { orders: -1, spent: -1 },
    last: { lastAt: -1 },
    cancels: { badTimes: -1, orders: -1 },
    joined: { joinedAt: -1 },
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// the filters as a User match; throws for a bad shop id
function matchOf(query) {
    const match = { role: 'customer' };
    if (query.tenantId !== undefined) {
        if (!mongoose.isValidObjectId(query.tenantId)) throw httpError(400, 'Invalid tenantId');
        match.tenantId = new mongoose.Types.ObjectId(query.tenantId);
    }
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 40) : '';
    if (q) match.$or = [{ name: { $regex: esc(q), $options: 'i' } }, ...(/^\d{3,10}$/.test(q) ? [{ phone: { $regex: esc(q) } }] : [])];
    return match;
}

// the customers with their order numbers. Customers who never ordered are listed too (0 orders).
function pipeline(match, sort, tail) {
    return [
        { $match: match },
        { $lookup: {
            from: Order.collection.name, let: { uid: '$_id' },
            pipeline: [
                { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
                { $group: {
                    _id: null, orders: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                    spent: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$bulkTotal', { $ifNull: ['$pricing.total', 0] }] }, 0] } },
                    cancelled: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'customer'] }] }, 1, 0] } },
                    noShow: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'undelivered'] }, { $eq: ['$undelivered.reasonCode', 'customer'] }] }, 1, 0] } },
                    lastAt: { $max: '$createdAt' },
                } },
            ],
            as: 'st',
        } },
        { $addFields: { st: { $first: '$st' } } },
        { $project: {
            tenantId: 1, name: 1, phone: 1, isBlocked: 1, joinedAt: '$createdAt',
            orders: { $ifNull: ['$st.orders', 0] }, delivered: { $ifNull: ['$st.delivered', 0] }, spent: { $ifNull: ['$st.spent', 0] },
            cancelled: { $ifNull: ['$st.cancelled', 0] }, noShow: { $ifNull: ['$st.noShow', 0] }, lastAt: '$st.lastAt',
        } },
        { $addFields: { badTimes: { $add: ['$cancelled', '$noShow'] } } },
        { $sort: { ...(SORTS[sort] || SORTS.spent), _id: 1 } },
        ...tail,
    ];
}

// full numbers: supreme admin only, and always written down
async function phoneMode(req) {
    if (req.query.full !== '1') return { full: false };
    if (!isSupreme(req.admin)) throw httpError(403, 'Only the supreme admin can see full phone numbers');
    return { full: true };
}
const writeDown = (req, what) => AuditLog.create({
    actorType: 'superadmin', actorId: req.admin?._id, actorLabel: req.admin?.email, action: what, method: req.method, path: req.originalUrl.split('?')[0],
    query: { tenantId: req.query.tenantId, q: req.query.q, sort: req.query.sort, page: req.query.page }, ip: req.ip,
}).catch((e) => console.error('Audit log error:', e.message));

const shape = (r, names, full) => ({
    userId: String(r._id), tenantId: String(r.tenantId), shopName: names.get(String(r.tenantId)) || 'Unknown shop',
    name: r.name || '', phone: full ? (r.phone || '') : (maskPhone(r.phone) || ''),
    orders: r.orders, delivered: r.delivered, spent: r.spent, cancelled: r.cancelled, noShow: r.noShow,
    lastAt: r.lastAt || null, joinedAt: r.joinedAt, blocked: !!r.isBlocked,
});
const namesOf = async (rows) => new Map((await Tenant.find({ _id: { $in: [...new Set(rows.map((r) => String(r.tenantId)))] } }).select('name').lean()).map((t) => [String(t._id), t.name]));

router.get('/customers', wrap(async (req, res) => {
    const { full } = await phoneMode(req);
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 30, 1, 50);
    const match = matchOf(req.query);
    const [rows, total] = await Promise.all([
        User.aggregate(pipeline(match, req.query.sort, [{ $skip: (page - 1) * limit }, { $limit: limit }])),
        User.countDocuments(match),
    ]);
    if (full) writeDown(req, 'SEE FULL CUSTOMER PHONES');
    const names = await namesOf(rows);
    res.json({ items: rows.map((r) => shape(r, names, full)), total, page, hasMore: page * limit < total, fullPhones: full });
}));

router.get('/customers/export', wrap(async (req, res) => {
    const { full } = await phoneMode(req);
    const rows = await User.aggregate(pipeline(matchOf(req.query), req.query.sort, [{ $limit: EXPORT_MAX }]));
    if (full) writeDown(req, 'DOWNLOAD CUSTOMERS WITH FULL PHONES');
    const names = await namesOf(rows);
    const buf = await buildSheet({
        title: 'Customers',
        columns: [
            { header: 'Shop', key: 'shop' },
            { header: 'Name', key: 'name' },
            { header: 'Phone', key: 'phone', kind: 'center' },
            { header: 'Joined (India time)', key: 'joined', kind: 'date' },
            { header: 'Orders', key: 'orders', kind: 'int' },
            { header: 'Delivered', key: 'delivered', kind: 'int' },
            { header: 'Total spent (₹)', key: 'spent', kind: 'money' },
            { header: 'Cancelled by him', key: 'cancelled', kind: 'int' },
            { header: 'Not at home', key: 'noShow', kind: 'int' },
            { header: 'Last order', key: 'last', kind: 'date' },
            { header: 'Blocked', key: 'blocked', kind: 'center' },
        ],
        rows: rows.map((r) => {
            const c = shape(r, names, full);
            return { shop: c.shopName, name: c.name, phone: c.phone, joined: c.joinedAt, orders: c.orders, delivered: c.delivered, spent: c.spent, cancelled: c.cancelled, noShow: c.noShow, last: c.lastAt, blocked: c.blocked ? 'Yes' : '' };
        }),
    });
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', 'attachment; filename="customers.xlsx"');
    res.send(buf);
}));

module.exports = router;
