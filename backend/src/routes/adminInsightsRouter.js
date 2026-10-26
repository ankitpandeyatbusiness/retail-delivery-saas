// Superadmin: search, shop health, readiness, system and backups, Excel exports. Mounted under /api/admin.
//   GET  /search?q=                 shops, orders (number or customer phone), people (masked), invoices
//   GET  /insights/health?days=     platform numbers + a health score for every shop
//   GET  /tenants/:tid/readiness    "is this shop ready to go live" checklist with reasons
//   GET  /ops/system                database, SMS, jobs, flags
//   GET  /ops/backups               backup list and last run
//   POST /ops/backup                run a backup now
//   GET  /export/orders|customers|invoices   Excel sheet (colours, widths), up to 5000 rows
const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const User = require('../models/User');
const Rider = require('../models/Rider');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Complaint = require('../models/Complaint');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsLog = require('../models/SmsLog');
const loadTenant = require('../middlewares/loadTenant');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { maskPhone } = require('../utils/phoneHash');
const backups = require('../services/backupService');
const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');

const router = express.Router();
const IST_MS = 5.5 * 3600 * 1000;
const EXPORT_MAX = 5000;
const DAY = 86400000;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ist = (d) => (d ? new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 19) : '');

// ---------- search ----------
router.get('/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) throw httpError(400, 'Type at least 2 characters');
    const rx = new RegExp(esc(q), 'i');
    const digits = q.replace(/\D/g, '');
    const isPhone = /^[6-9]\d{9}$/.test(digits);
    const isNo = /^#?\d{1,8}$/.test(q) && !isPhone;

    const [shops, invoices, people, orders] = await Promise.all([
        Tenant.find({ $or: [{ name: rx }, { slug: rx }, { phone: rx }] }).select('name slug status phone billing.state').limit(8).lean(),
        SubscriptionInvoice.find({ invoiceNo: rx }).select('tenantId invoiceNo period total status').limit(8).lean(),
        isPhone ? User.find({ phone: digits }).select('tenantId phone name role').limit(10).lean() : [],
        isPhone
            ? Order.find({ 'customer.phone': digits }).sort({ createdAt: -1 }).select('tenantId orderNo status pricing.total createdAt customer.name').limit(10).lean()
            : isNo
                ? Order.find({ orderNo: Number(q.replace('#', '')) }).sort({ createdAt: -1 }).select('tenantId orderNo status pricing.total createdAt customer.name').limit(10).lean()
                : [],
    ]);
    const ids = [...new Set([...invoices, ...people, ...orders].map((x) => String(x.tenantId)))];
    const names = new Map((await Tenant.find({ _id: { $in: ids } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    res.json({
        q,
        shops: shops.map((t) => ({ id: t._id, name: t.name, slug: t.slug, status: t.status, billingState: t.billing?.state })),
        orders: orders.map((o) => ({ id: o._id, tenantId: o.tenantId, shop: names.get(String(o.tenantId)), orderNo: o.orderNo, status: o.status, totalPaise: Math.round((o.pricing?.total || 0) * 100), at: o.createdAt, customer: o.customer?.name || null })),
        people: people.map((u) => ({ id: u._id, tenantId: u.tenantId, shop: names.get(String(u.tenantId)), phone: maskPhone(u.phone), name: u.name || null, role: u.role })),
        invoices: invoices.map((i) => ({ id: i._id, tenantId: i.tenantId, shop: names.get(String(i.tenantId)), invoiceNo: i.invoiceNo, period: i.period, totalPaise: Math.round(i.total * 100), status: i.status })),
    });
}));

// ---------- shop health ----------
// Score starts at 100; each problem takes points off, and every deduction is listed in `reasons`.
function scoreShop(s, tenant, hasOrdersBefore) {
    const reasons = [];
    let score = 100;
    const take = (n, text) => { score -= n; reasons.push({ points: n, text }); };
    if (s.total >= 5) {
        const cancelRate = s.cancelled / s.total;
        const undeliveredRate = s.undelivered / s.total;
        if (cancelRate > 0.25) take(25, `${Math.round(cancelRate * 100)}% of orders were cancelled`);
        else if (cancelRate > 0.12) take(12, `${Math.round(cancelRate * 100)}% of orders were cancelled`);
        if (undeliveredRate > 0.05) take(15, `${Math.round(undeliveredRate * 100)}% of orders could not be delivered`);
        if (s.avgMinutes && s.avgMinutes > 75) take(15, `Delivery takes ${Math.round(s.avgMinutes)} minutes on average`);
        else if (s.avgMinutes && s.avgMinutes > 55) take(7, `Delivery takes ${Math.round(s.avgMinutes)} minutes on average`);
        if (s.stuck / s.total > 0.1) take(10, `${s.stuck} order(s) got stuck and needed an alert`);
    }
    if (s.complaints >= 3) take(Math.min(20, s.complaints * 3), `${s.complaints} complaints`);
    const rating = tenant.stats?.rating;
    if (rating?.count >= 5 && rating.avg < 3.5) take(15, `Rating is only ${rating.avg.toFixed(1)}`);
    if (!s.total) take(hasOrdersBefore ? 25 : 10, hasOrdersBefore ? 'No orders in this period' : 'No orders yet');
    if (tenant.billing?.state === 'paused') take(25, 'The shop is paused for non-payment');
    else if (tenant.billing?.state === 'grace') take(10, 'The rent is overdue (grace period)');
    if (tenant.status === 'suspended') take(30, 'The shop is suspended');
    score = Math.max(0, score);
    return { score, level: score >= 80 ? 'good' : score >= 55 ? 'watch' : 'bad', reasons };
}

router.get('/insights/health', wrap(async (req, res) => {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * DAY);
    const [tenants, orderAgg, complaintAgg, lastOrders] = await Promise.all([
        Tenant.find({}).select('name slug status billing.state billing.isLive stats.rating').lean(),
        Order.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: {
                _id: '$tenantId',
                total: { $sum: 1 },
                delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                undelivered: { $sum: { $cond: [{ $eq: ['$status', 'undelivered'] }, 1, 0] } },
                stuck: { $sum: { $cond: [{ $ifNull: ['$stuck.stage', false] }, 1, 0] } },
                revenue: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$pricing.total', 0] } },
                avgMs: { $avg: { $cond: [{ $and: [{ $eq: ['$status', 'delivered'] }, '$deliveredAt'] }, { $subtract: ['$deliveredAt', '$createdAt'] }, null] } },
            } },
        ]),
        Complaint.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
        Order.aggregate([{ $group: { _id: '$tenantId', last: { $max: '$createdAt' } } }]),
    ]);
    const om = new Map(orderAgg.map((o) => [String(o._id), o]));
    const cm = new Map(complaintAgg.map((c) => [String(c._id), c.n]));
    const lm = new Map(lastOrders.map((l) => [String(l._id), l.last]));
    const shops = tenants.map((t) => {
        const o = om.get(String(t._id)) || {};
        const s = {
            total: o.total || 0, delivered: o.delivered || 0, cancelled: o.cancelled || 0, undelivered: o.undelivered || 0,
            stuck: o.stuck || 0, complaints: cm.get(String(t._id)) || 0, avgMinutes: o.avgMs ? o.avgMs / 60000 : null,
        };
        const h = scoreShop(s, t, lm.has(String(t._id)));
        return {
            id: t._id, name: t.name, slug: t.slug, status: t.status, billingState: t.billing?.state || 'free', isLive: !!t.billing?.isLive,
            orders: s.total, delivered: s.delivered, cancelled: s.cancelled, undelivered: s.undelivered, stuck: s.stuck,
            complaints: s.complaints, avgMinutes: s.avgMinutes ? Math.round(s.avgMinutes) : null,
            revenuePaise: Math.round((o.revenue || 0) * 100), rating: t.stats?.rating?.avg || null,
            lastOrderAt: lm.get(String(t._id)) || null, ...h,
        };
    }).sort((a, b) => a.score - b.score);
    const sum = (f) => shops.reduce((a, s) => a + s[f], 0);
    const total = sum('orders');
    res.json({
        days,
        platform: {
            shops: shops.length, orders: total, delivered: sum('delivered'), cancelled: sum('cancelled'), undelivered: sum('undelivered'),
            complaints: sum('complaints'), revenuePaise: sum('revenuePaise'),
            cancelRate: total ? Math.round((sum('cancelled') / total) * 1000) / 10 : 0,
            successRate: total ? Math.round((sum('delivered') / total) * 1000) / 10 : 0,
            needAttention: shops.filter((s) => s.level !== 'good').length,
        },
        shops,
    });
}));

// ---------- readiness ----------
router.get('/tenants/:tid/readiness', loadTenant, wrap(async (req, res) => {
    const t = await Tenant.findById(req.tenantDoc._id).lean();
    const [categories, products, owner, riders] = await Promise.all([
        Category.countDocuments({ tenantId: t._id }),
        Product.countDocuments({ tenantId: t._id, isActive: true }),
        User.countDocuments({ tenantId: t._id, role: 'admin' }),
        Rider.countDocuments({ tenantId: t._id, isActive: true }),
    ]);
    const hours = t.settings?.hours?.weekly;
    const checks = [
        { key: 'logo', label: 'Logo uploaded', ok: !!t.logo, fix: 'Upload the shop logo' },
        { key: 'hero', label: 'Banner pictures', ok: (t.heroImages || []).length > 0, fix: 'Add at least one home picture' },
        { key: 'contact', label: 'Phone and address', ok: !!(t.phone && t.address?.line && t.address?.city), fix: 'Fill phone, address and city' },
        { key: 'location', label: 'Map location and delivery radius', ok: t.delivery?.latitude != null && t.delivery?.longitude != null && !!t.delivery?.radiusKm, fix: 'Set latitude, longitude and radius. Without them anyone, anywhere can order delivery' },
        { key: 'menu', label: 'Menu has categories and items', ok: categories > 0 && products > 0, fix: `${categories} categories, ${products} items` },
        { key: 'hours', label: 'Opening hours set', ok: !!hours, fix: 'Without hours the shop is always open', optional: true },
        { key: 'owner', label: 'Owner account', ok: owner > 0, fix: 'Add the owner phone number' },
        { key: 'rider', label: 'At least one rider', ok: riders > 0, fix: 'Add a rider, or the shop cannot deliver' },
        { key: 'payments', label: 'Online payments connected', ok: !!(t.payments?.enabled && t.payments?.verifiedAt), fix: 'Add Razorpay keys and test the connection', optional: true },
        { key: 'business', label: 'Business details (name, GST)', ok: !!t.business?.legalName, fix: 'Add the legal name', optional: true },
        { key: 'package', label: 'Android package name', ok: !!t.androidPackage, fix: 'Set the app package name', optional: true },
        { key: 'live', label: 'Gone live', ok: !!t.billing?.isLive, fix: 'Press Go live when everything above is ready' },
    ];
    const required = checks.filter((c) => !c.optional);
    res.json({
        tenantId: t._id,
        checks,
        passed: checks.filter((c) => c.ok).length,
        total: checks.length,
        ready: required.filter((c) => c.key !== 'live').every((c) => c.ok),
    });
}));

// ---------- system ----------
const JOBS = [{ name: 'db-backup', label: 'Database backup', hour: 2 }, { name: 'nightly-reconcile', label: 'Nightly money check', hour: 3 }];
const istDay = (d) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

router.get('/ops/system', wrap(async (req, res) => {
    const t0 = Date.now();
    let dbOk = true;
    try { await mongoose.connection.db.admin().ping(); } catch { dbOk = false; }
    const dbMs = Date.now() - t0;
    const locks = mongoose.connection.collection('job_locks');
    const jobs = [];
    for (const j of JOBS) {
        const last = await locks.find({ _id: { $regex: `^${esc(j.name)}:` } }).sort({ _id: -1 }).limit(1).toArray();
        jobs.push({ name: j.name, label: j.label, hour: j.hour, lastDay: last[0]?._id.split(':')[1] || null, lastAt: last[0]?.at || null });
    }
    const tenMin = new Date(Date.now() - 10 * 60000);
    const [failed, sent] = await Promise.all([
        SmsLog.countDocuments({ createdAt: { $gte: tenMin }, status: 'failed' }),
        SmsLog.countDocuments({ createdAt: { $gte: tenMin }, status: { $in: ['sent', 'mock'] } }),
    ]);
    const flag = (name, on, bad) => ({ name, on, warn: !!bad });
    const prod = process.env.NODE_ENV === 'production';
    res.json({
        now: new Date(), uptimeSec: Math.round(process.uptime()), node: process.version, env: process.env.NODE_ENV || 'development',
        database: { ok: dbOk, pingMs: dbMs },
        sms: { failedLast10Min: failed, sentLast10Min: sent, failing: failed >= 3 },
        jobs,
        flags: [
            flag('SMS in test mode', process.env.SMS_MOCK === 'true', prod && process.env.SMS_MOCK === 'true'),
            flag('Payments in test mode', process.env.PAYMENTS_MOCK === 'true', prod && process.env.PAYMENTS_MOCK === 'true'),
            flag('Email in test mode', process.env.EMAIL_MOCK === 'true', prod && process.env.EMAIL_MOCK === 'true'),
            flag('Files stored locally (test mode)', process.env.STORAGE_MOCK === 'true', prod && process.env.STORAGE_MOCK === 'true'),
            flag('Push alerts in test mode', process.env.PUSH_MOCK === 'true', false),
            flag('Push alerts configured', !!process.env.FCM_SERVICE_ACCOUNT_B64, prod && !process.env.FCM_SERVICE_ACCOUNT_B64),
        ],
    });
}));

// ---------- backups ----------
let backupRunning = false;
router.get('/ops/backups', wrap(async (req, res) => {
    const list = await backups.listBackups();
    const newest = list.daily[0] || null;
    const ageDays = newest ? Math.floor((Date.now() - new Date(`${newest}T00:00:00+05:30`)) / DAY) : null;
    res.json({ ...list, newest, ageDays, stale: ageDays === null || ageDays > 1, running: backupRunning, today: istDay(new Date()) });
}));

router.post('/ops/backup', wrap(async (req, res) => {
    if (backupRunning) throw httpError(409, 'A backup is already running');
    backupRunning = true;
    try {
        const r = await backups.createBackup({ db: mongoose.connection.db, now: new Date() });
        res.json({ ok: true, ...r });
    } finally {
        backupRunning = false;
    }
}));

// ---------- exports ----------
// Excel files (colours, widths, status colours, totals).
const range = (q) => {
    const f = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) f.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) f.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + DAY);
    return Object.keys(f).length ? f : null;
};
const tenantNames = async () => new Map((await Tenant.find({}).select('name').lean()).map((t) => [String(t._id), t.name]));

// columns: [{ header, key, kind }]; rows: [{ key: value }]. Dates are JS Dates, money is in rupees.
async function sendExport(req, res, { file, title, columns, rows, total }) {
    const buf = await buildSheet({ title, columns, rows, total });
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    return res.send(buf);
}

router.get('/export/orders', wrap(async (req, res) => {
    const match = {};
    const r = range(req.query);
    if (r) match.createdAt = r;
    if (/^[a-f0-9]{24}$/.test(req.query.tenantId || '')) match.tenantId = new mongoose.Types.ObjectId(req.query.tenantId);
    const [orders, names] = await Promise.all([
        Order.find(match).sort({ createdAt: -1 }).limit(EXPORT_MAX).select('tenantId orderNo status orderType payment pricing createdAt deliveredAt customer').lean(),
        tenantNames(),
    ]);
    await sendExport(req, res, {
        file: 'orders',
        title: 'Orders',
        total: true,
        columns: [
            { header: 'Date (India time)', key: 'at', kind: 'date' },
            { header: 'Shop', key: 'shop' },
            { header: 'Order no', key: 'no', kind: 'int' },
            { header: 'Status', key: 'status', kind: 'status' },
            { header: 'Type', key: 'type', kind: 'center' },
            { header: 'Payment', key: 'method', kind: 'center' },
            { header: 'Payment status', key: 'pay', kind: 'status' },
            { header: 'Total', key: 'total', kind: 'money' },
            { header: 'Customer', key: 'customer' },
            { header: 'Phone', key: 'phone', kind: 'center' },
            { header: 'Delivered', key: 'delivered', kind: 'date' },
        ],
        rows: orders.map((o) => ({
            at: o.createdAt, shop: names.get(String(o.tenantId)) || '', no: o.orderNo, status: o.status,
            type: String(o.orderType || '').replace(/_/g, ' '), method: String(o.payment?.method || '').toUpperCase(), pay: o.payment?.status,
            total: o.pricing?.total || 0, customer: o.customer?.name || '', phone: maskPhone(o.customer?.phone || '') || '', delivered: o.deliveredAt,
        })),
    });
}));

router.get('/export/customers', wrap(async (req, res) => {
    const match = { role: 'customer' };
    if (/^[a-f0-9]{24}$/.test(req.query.tenantId || '')) match.tenantId = new mongoose.Types.ObjectId(req.query.tenantId);
    const [users, names] = await Promise.all([
        User.find(match).sort({ createdAt: -1 }).limit(EXPORT_MAX).select('tenantId phone name createdAt').lean(),
        tenantNames(),
    ]);
    await sendExport(req, res, {
        file: 'customers',
        title: 'Customers',
        columns: [
            { header: 'Joined (India time)', key: 'at', kind: 'date' },
            { header: 'Shop', key: 'shop' },
            { header: 'Name', key: 'name' },
            { header: 'Phone', key: 'phone', kind: 'center' },
        ],
        rows: users.map((u) => ({ at: u.createdAt, shop: names.get(String(u.tenantId)) || '', name: u.name || '', phone: maskPhone(u.phone) || '' })),
    });
}));

router.get('/export/invoices', wrap(async (req, res) => {
    const match = {};
    const r = range(req.query);
    if (r) match.issueDate = r;
    if (['pending', 'paid', 'void'].includes(req.query.status)) match.status = req.query.status;
    const [list, names] = await Promise.all([
        SubscriptionInvoice.find(match).sort({ issueDate: -1 }).limit(EXPORT_MAX).lean(),
        tenantNames(),
    ]);
    await sendExport(req, res, {
        file: 'invoices',
        title: 'Rent invoices',
        total: true,
        columns: [
            { header: 'Invoice no', key: 'no', kind: 'center' },
            { header: 'Shop', key: 'shop' },
            { header: 'Period', key: 'period', kind: 'center' },
            { header: 'Issued', key: 'issued', kind: 'date' },
            { header: 'Due', key: 'due', kind: 'date' },
            { header: 'Amount (before GST)', key: 'base', kind: 'money' },
            { header: 'GST', key: 'gst', kind: 'money' },
            { header: 'Total', key: 'total', kind: 'money' },
            { header: 'Status', key: 'status', kind: 'status' },
            { header: 'Paid on', key: 'paidAt', kind: 'date' },
            { header: 'Paid by', key: 'mode', kind: 'center' },
            { header: 'Reference', key: 'ref' },
        ],
        rows: list.map((i) => ({
            no: i.invoiceNo, shop: names.get(String(i.tenantId)) || '', period: i.period || '', issued: i.issueDate, due: i.dueDate,
            base: i.baseAmount || 0, gst: i.gstAmount || 0, total: i.total || 0, status: i.status, paidAt: i.paidAt,
            mode: String(i.paymentMode || '').replace(/_/g, ' '), ref: i.paymentRef || '',
        })),
    });
}));

module.exports = router;
