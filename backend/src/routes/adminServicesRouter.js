// The super admin's view of Services and Table booking. Mounted inside adminRouter. Everything here is READ-ONLY, except the defaults.
// The super admin never replies to a guest or touches a booking: the owner does (the per-shop switches are in "App features").
//   GET /services/overview?days=30&tenantId=      totals and one row per shop: inquiries, bookings, the booking money, the waitlist
//   GET /services/inquiries?tenantId&status&days&page&limit      the list      GET /services/inquiries/:id   one thread
//   GET /services/bookings?tenantId&status&days&date&page&limit
//   GET /services/defaults     PUT /services/defaults { reminderHours?, kinds?: { bulk|tiffin|party|other: { quickTexts?, quickReplies?, questions? } } }
//   POST /services/defaults/reset { kind }     back to the built-in set for one starter kind
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const Tenant = require('../models/Tenant');
const ServiceInquiry = require('../models/ServiceInquiry');
const TableBooking = require('../models/TableBooking');
const WaitlistEntry = require('../models/WaitlistEntry');
const PlatformSettings = require('../models/PlatformSettings');
const svc = require('../services/shopServices');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const MIN = 60000;

const days = (q) => Math.min(365, Math.max(1, Math.round(Number(q.days)) || 30));
const tenantOf = (q) => { if (q.tenantId === undefined || q.tenantId === '') return null; if (!isId(String(q.tenantId))) throw httpError(400, 'Not a valid shop'); return new mongoose.Types.ObjectId(String(q.tenantId)); };
const names = async (ids) => new Map((await Tenant.find({ _id: { $in: ids } }).select('name slug').lean()).map((t) => [String(t._id), { name: t.name, slug: t.slug }]));
const paging = (q) => { const limit = Math.min(100, Math.max(1, Math.round(Number(q.limit)) || 30)); const page = Math.max(1, Math.round(Number(q.page)) || 1); return { limit, page, skip: (page - 1) * limit }; };

router.get('/services/overview', wrap(async (req, res) => {
    const since = new Date(Date.now() - days(req.query) * 86400000);
    const tid = tenantOf(req.query);
    const where = { createdAt: { $gte: since }, ...(tid ? { tenantId: tid } : {}) };
    const hours = (await svc.loadDefaults()).reminderHours || svc.DEFAULT_REMINDER_HOURS;
    const stale = Date.now() - hours * 3600000;

    const [inquiries, bookings, waiting, withFeature] = await Promise.all([
        ServiceInquiry.find(where).select('tenantId status ownerUnread lastMessageAt createdAt messages.from messages.at').limit(20000).lean(),
        TableBooking.find(where).select('tenantId status deposit.amount deposit.status payment.rzpPaymentId').limit(50000).lean(),
        WaitlistEntry.aggregate([{ $match: { ...where, status: 'waiting' } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
        Tenant.find({ $or: [{ 'settings.features.services': true }, { 'settings.features.tableBooking': true }], ...(tid ? { _id: tid } : {}) }).select('_id').lean(),
    ]);
    const row = (id) => ({ tenantId: String(id), inquiries: { total: 0, new: 0, unanswered: 0, replyMin: [] }, bookings: { total: 0, confirmed: 0, seated: 0, noShow: 0, cancelled: 0 }, money: { collected: 0, refunded: 0, kept: 0, adjusted: 0, held: 0 }, waiting: 0 });
    const rows = new Map();
    const get = (id) => { const k = String(id); if (!rows.has(k)) rows.set(k, row(id)); return rows.get(k); };
    for (const t of withFeature) get(t._id);

    for (const i of inquiries) {
        const r = get(i.tenantId).inquiries;
        r.total += 1;
        if (i.status === 'new') r.new += 1;
        if (['new', 'replied', 'quoted'].includes(i.status) && i.ownerUnread > 0 && new Date(i.lastMessageAt).getTime() <= stale) r.unanswered += 1;
        const first = (i.messages || []).find((m) => m.from === 'owner');
        if (first) r.replyMin.push(Math.max(0, (new Date(first.at).getTime() - new Date(i.createdAt).getTime()) / MIN));
    }
    for (const b of bookings) {
        const r = get(b.tenantId);
        if (!['held', 'expired'].includes(b.status)) {   // an unpaid hold is not a booking
            r.bookings.total += 1;
            if (b.status === 'confirmed') r.bookings.confirmed += 1;
            else if (b.status === 'seated') r.bookings.seated += 1;
            else if (b.status === 'no_show') r.bookings.noShow += 1;
            else if (b.status === 'cancelled') r.bookings.cancelled += 1;
        }
        if (b.payment?.rzpPaymentId) {   // money that really came in
            const a = b.deposit?.amount || 0; const s = b.deposit?.status;
            r.money.collected += a;
            if (s === 'refunded' || s === 'refunding' || s === 'refund_failed') r.money.refunded += a;
            else if (s === 'kept') r.money.kept += a;
            else if (s === 'adjusted') r.money.adjusted += a;
            else if (s === 'paid') r.money.held += a;
        }
    }
    for (const w of waiting) get(w._id).waiting = w.n;

    const info = await names([...rows.keys()]);
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const shops = [...rows.values()].map((r) => ({ ...r, shop: info.get(r.tenantId) || { name: 'Removed shop' }, inquiries: { ...r.inquiries, replyMin: undefined, avgReplyMin: avg(r.inquiries.replyMin) } }))
        .sort((a, b) => (b.inquiries.total + b.bookings.total) - (a.inquiries.total + a.bookings.total));
    const sum = (f) => shops.reduce((n, s) => n + f(s), 0);
    const all = [].concat(...[...rows.values()].map((r) => r.inquiries.replyMin));
    res.json({
        days: days(req.query), reminderHours: hours, shops,
        totals: {
            inquiries: { total: sum((s) => s.inquiries.total), new: sum((s) => s.inquiries.new), unanswered: sum((s) => s.inquiries.unanswered), avgReplyMin: avg(all) },
            bookings: { total: sum((s) => s.bookings.total), confirmed: sum((s) => s.bookings.confirmed), seated: sum((s) => s.bookings.seated), noShow: sum((s) => s.bookings.noShow), cancelled: sum((s) => s.bookings.cancelled) },
            money: { collected: sum((s) => s.money.collected), refunded: sum((s) => s.money.refunded), kept: sum((s) => s.money.kept), adjusted: sum((s) => s.money.adjusted), held: sum((s) => s.money.held) },
            waiting: sum((s) => s.waiting),
        },
    });
}));

router.get('/services/inquiries', wrap(async (req, res) => {
    const tid = tenantOf(req.query);
    const { limit, page, skip } = paging(req.query);
    const where = { createdAt: { $gte: new Date(Date.now() - days(req.query) * 86400000) }, ...(tid ? { tenantId: tid } : {}), ...(req.query.status ? { status: String(req.query.status) } : {}) };
    const [items, total] = await Promise.all([
        ServiceInquiry.find(where).select('-answers -note -messages.text').sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
        ServiceInquiry.countDocuments(where),
    ]);
    const info = await names([...new Set(items.map((i) => String(i.tenantId)))]);
    res.json({ items: items.map((i) => ({ ...i, shop: info.get(String(i.tenantId)) || null, messageCount: (i.messages || []).length, messages: undefined })), total, page, hasMore: skip + items.length < total });
}));

// one thread, to read (a dispute, a complaint). The owner's private note stays private.
router.get('/services/inquiries/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Inquiry not found');
    const i = await ServiceInquiry.findById(req.params.id).select('-note').lean();
    if (!i) throw httpError(404, 'Inquiry not found');
    res.json({ ...i, shop: (await names([String(i.tenantId)])).get(String(i.tenantId)) || null });
}));

router.get('/services/bookings', wrap(async (req, res) => {
    const tid = tenantOf(req.query);
    const { limit, page, skip } = paging(req.query);
    const where = {
        status: req.query.status ? String(req.query.status) : { $nin: ['held', 'expired'] },
        ...(tid ? { tenantId: tid } : {}),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? { date: req.query.date } : { createdAt: { $gte: new Date(Date.now() - days(req.query) * 86400000) } }),
    };
    const [items, total] = await Promise.all([
        TableBooking.find(where).select('-payment.rzpOrderId').sort({ startsAt: -1 }).skip(skip).limit(limit).lean(),
        TableBooking.countDocuments(where),
    ]);
    const info = await names([...new Set(items.map((b) => String(b.tenantId)))]);
    res.json({ items: items.map((b) => ({ ...b, shop: info.get(String(b.tenantId)) || null })), total, page, hasMore: skip + items.length < total });
}));

// ---- defaults: the reminder delay, and what a new service of each starter kind begins with
const effective = (stored) => ({
    reminderHours: stored.reminderHours || svc.DEFAULT_REMINDER_HOURS,
    kinds: Object.fromEntries(svc.STARTER_KINDS.map((k) => {
        const base = svc.newDoc(k, {});
        const mine = svc.newDoc(k, stored);
        return [k, { name: base.name, quickTexts: mine.quickTexts || [], quickReplies: mine.quickReplies || [], questions: mine.questions, changed: !!stored.kinds?.[k] }];
    })),
});
router.get('/services/defaults', wrap(async (req, res) => { res.json(effective(await svc.loadDefaults())); }));
router.put('/services/defaults', wrap(async (req, res) => {
    const cur = await svc.loadDefaults();
    const put = svc.cleanDefaults(req.body || {});
    const next = { ...cur, ...(put.reminderHours ? { reminderHours: put.reminderHours } : {}), kinds: { ...(cur.kinds || {}), ...(put.kinds || {}) } };
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { servicesDefaults: next } }, { upsert: true });
    res.json(effective(next));
}));
router.post('/services/defaults/reset', wrap(async (req, res) => {
    const kind = String(req.body?.kind || '');
    if (!svc.STARTER_KINDS.includes(kind)) throw httpError(400, 'Unknown starter service');
    const cur = await svc.loadDefaults();
    const kinds = { ...(cur.kinds || {}) }; delete kinds[kind];
    const next = { ...cur, kinds };
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { servicesDefaults: next } }, { upsert: true });
    res.json(effective(next));
}));

module.exports = router;
