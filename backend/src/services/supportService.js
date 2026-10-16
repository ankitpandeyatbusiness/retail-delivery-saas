// Help & support between a shop owner and the platform team.
//   owner side   create, list, read, reply, resolve, reopen (by replying within 7 days), rate
//   platform side list, read, reply, private note, set status / priority, counts
// Every owner message tells the superadmin (an alert + push); every platform reply tells the owner (inbox + push).
const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const Counter = require('../models/Counter');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');
const notify = require('./notificationService');
const adminAlerts = require('./adminAlerts');
const { httpError } = require('../middlewares/apiErrors');

const REOPEN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NEW_PER_DAY = 5;
const MAX_OPEN = 10;
const MAX_PHOTOS = 3;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const snippet = (t, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/* ------------------------------ what is allowed in ------------------------------ */
function cleanText(v, label = 'Message') {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t) throw httpError(400, `${label} cannot be empty`);
    if (t.length > 2000) throw httpError(400, `${label} can be up to 2000 characters`);
    return t;
}
function cleanPhotos(v) {
    if (v === undefined) return [];
    const bad = !Array.isArray(v) || v.length > MAX_PHOTOS || v.some((p) => typeof p !== 'string' || !/^https:\/\//.test(p) || p.length > 500);
    if (bad) throw httpError(400, `You can add up to ${MAX_PHOTOS} pictures`);
    return v;
}
const cleanShort = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined) || undefined;

/* ------------------------------ views ------------------------------ */
const messageView = (m) => ({ id: m._id, from: m.from, text: m.text, photos: m.photos || [], by: m.by || null, at: m.at });

// the owner never sees a private note
const ownerTicket = (t) => ({
    id: t._id, number: t.number, category: t.category, subject: t.subject, status: t.status,
    messages: (t.messages || []).filter((m) => m.from !== 'note').map(messageView),
    lastMessageAt: t.lastMessageAt, ownerUnread: !!t.ownerUnread, createdAt: t.createdAt,
    resolvedAt: t.resolvedAt || null, rating: t.rating?.stars ? t.rating : null,
    canReopen: t.status === 'resolved' && !!t.resolvedAt && Date.now() - new Date(t.resolvedAt).getTime() < REOPEN_MS,
});
const ownerRow = (t) => {
    const last = [...(t.messages || [])].reverse().find((m) => m.from !== 'note');
    return {
        id: t._id, number: t.number, category: t.category, subject: t.subject, status: t.status,
        last: last ? { from: last.from, text: snippet(last.text) } : null,
        lastMessageAt: t.lastMessageAt, ownerUnread: !!t.ownerUnread,
    };
};

/* ------------------------------ platform contact card ------------------------------ */
const INFO_DEFAULT = { phone: '', whatsapp: '', email: '', hours: '', replyPromise: 'We reply within 24 hours.' };
async function getInfo() {
    const p = await PlatformSettings.findById('main').select('support').lean();
    return { ...INFO_DEFAULT, ...(p?.support || {}) };
}
async function setInfo(body = {}) {
    const set = {};
    const put = (k, max, re) => {
        if (body[k] === undefined) return;
        const v = typeof body[k] === 'string' ? body[k].trim() : null;
        if (v === null || v.length > max) throw httpError(400, `${k} can be up to ${max} characters`);
        if (v && re && !re.test(v)) throw httpError(400, `Enter a valid ${k}`);
        set[`support.${k}`] = v;
    };
    put('phone', 20, /^[0-9+\-\s]{6,20}$/);
    put('whatsapp', 20, /^[0-9+\-\s]{6,20}$/);
    put('email', 120, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
    put('hours', 120);
    put('replyPromise', 160);
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true, setDefaultsOnInsert: true });
    return getInfo();
}

/* ------------------------------ owner side ------------------------------ */
async function create({ tenant, userId, body }) {
    const b = body || {};
    if (!SupportTicket.CATEGORIES.includes(b.category)) throw httpError(400, 'Choose what your request is about');
    const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
    if (subject.length < 3 || subject.length > 100) throw httpError(400, 'Write a title of 3 to 100 characters');
    const text = cleanText(b.message, 'Message');
    const photos = cleanPhotos(b.photos);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (await SupportTicket.countDocuments({ tenantId: tenant._id, createdAt: { $gte: since } }) >= MAX_NEW_PER_DAY) {
        throw httpError(429, `You can send ${MAX_NEW_PER_DAY} new requests a day. Please add to an earlier request or try tomorrow.`);
    }
    if (await SupportTicket.countDocuments({ tenantId: tenant._id, status: { $ne: 'resolved' } }) >= MAX_OPEN) {
        throw httpError(409, 'You already have many open requests. Please wait for replies, or close the ones that are done.');
    }
    const user = await User.findOne({ _id: userId, tenantId: tenant._id }).select('name phone').lean();
    const by = user?.name || user?.phone || 'Owner';
    const { seq } = await Counter.findOneAndUpdate({ _id: 'support' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();

    const t = await SupportTicket.create({
        number: 1000 + seq, tenantId: tenant._id, userId, category: b.category, subject,
        messages: [{ from: 'owner', text, photos, by }],
        lastFrom: 'owner', platformUnread: true, ownerUnread: false,
        context: { appVersion: cleanShort(b.appVersion, 20), platform: cleanShort(b.platform, 20) },
    });
    adminAlerts.alert('admin_support_new', { tenantId: tenant._id, vars: { number: t.number, subject, category: t.category }, data: { ticketId: String(t._id) } });
    return ownerTicket(t.toObject());
}

async function ownerList({ tenantId, status, page = 1 }) {
    const filter = { tenantId };
    if (status === 'open') filter.status = { $ne: 'resolved' };
    else if (status === 'resolved') filter.status = 'resolved';
    const limit = 20;
    const rows = await SupportTicket.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const unread = await SupportTicket.countDocuments({ tenantId, ownerUnread: true });
    return { items: rows.map(ownerRow), unreadCount: unread, page, hasMore };
}

async function mine(tenantId, id) {
    if (!isId(id)) throw httpError(404, 'Request not found');
    const t = await SupportTicket.findOne({ _id: id, tenantId });
    if (!t) throw httpError(404, 'Request not found');
    return t;
}

async function ownerGet({ tenantId, id }) {
    const t = await mine(tenantId, id);
    if (t.ownerUnread) { t.ownerUnread = false; await t.save(); }
    return ownerTicket(t.toObject());
}

async function ownerReply({ tenant, userId, id, body }) {
    const t = await mine(tenant._id, id);
    const text = cleanText(body?.message);
    const photos = cleanPhotos(body?.photos);
    if (t.status === 'resolved') {
        if (!t.resolvedAt || Date.now() - t.resolvedAt.getTime() > REOPEN_MS) throw httpError(409, 'This request was closed more than 7 days ago. Please start a new request.');
        t.resolvedAt = undefined; t.resolvedBy = undefined;
    }
    const user = await User.findOne({ _id: userId, tenantId: tenant._id }).select('name phone').lean();
    t.messages.push({ from: 'owner', text, photos, by: user?.name || user?.phone || 'Owner' });
    Object.assign(t, { status: 'open', lastFrom: 'owner', lastMessageAt: new Date(), platformUnread: true });
    await t.save();
    adminAlerts.alert('admin_support_reply', { tenantId: tenant._id, vars: { number: t.number, subject: t.subject }, data: { ticketId: String(t._id) } });
    return ownerTicket(t.toObject());
}

async function ownerResolve({ tenantId, id }) {
    const t = await mine(tenantId, id);
    if (t.status !== 'resolved') Object.assign(t, { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'owner' });
    await t.save();
    return ownerTicket(t.toObject());
}

async function ownerRate({ tenantId, id, body }) {
    const t = await mine(tenantId, id);
    if (t.status !== 'resolved') throw httpError(409, 'You can rate a request after it is resolved');
    if (t.rating?.stars) throw httpError(409, 'You already rated this request');
    const stars = body?.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw httpError(400, 'stars must be 1 to 5');
    t.rating = { stars, comment: cleanShort(body?.comment, 300), at: new Date() };
    await t.save();
    return ownerTicket(t.toObject());
}

/* ------------------------------ platform side ------------------------------ */
async function shopNames(ids) {
    const rows = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
    return new Map(rows.map((x) => [String(x._id), x]));
}

async function adminList({ status, q, tenantId, page = 1 }) {
    const filter = {};
    if (status && status !== 'all') {
        if (!SupportTicket.STATUSES.includes(status)) throw httpError(400, 'Unknown status');
        filter.status = status;
    }
    if (tenantId) { if (!isId(tenantId)) throw httpError(400, 'Bad shop id'); filter.tenantId = tenantId; }
    const term = typeof q === 'string' ? q.trim().slice(0, 40) : '';
    if (/^#?\d{3,7}$/.test(term)) filter.number = Number(term.replace('#', ''));
    else if (term) {
        const shops = await Tenant.find({ name: new RegExp(esc(term), 'i') }).select('_id').limit(50).lean();
        filter.$or = [{ subject: new RegExp(esc(term), 'i') }, { tenantId: { $in: shops.map((s) => s._id) } }];
    }
    const limit = 25;
    const rows = await SupportTicket.find(filter).sort({ platformUnread: -1, lastMessageAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const names = await shopNames([...new Set(rows.map((r) => String(r.tenantId)))]);
    return {
        items: rows.map((t) => {
            const last = [...t.messages].reverse().find((m) => m.from !== 'note');
            return {
                id: t._id, number: t.number, subject: t.subject, category: t.category, status: t.status, priority: t.priority,
                shop: names.get(String(t.tenantId))?.name || 'Shop', shopSlug: names.get(String(t.tenantId))?.slug || null, tenantId: t.tenantId,
                last: last ? { from: last.from, text: snippet(last.text) } : null,
                lastMessageAt: t.lastMessageAt, platformUnread: !!t.platformUnread, rating: t.rating?.stars || null,
            };
        }),
        counts: await adminCounts(),
        page, hasMore,
    };
}

async function adminCounts() {
    const rows = await SupportTicket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, unread: { $sum: { $cond: ['$platformUnread', 1, 0] } } } }]);
    const out = { open: 0, answered: 0, resolved: 0, unread: 0 };
    for (const r of rows) { out[r._id] = r.n; out.unread += r.unread; }
    return out;
}

async function adminGet(id) {
    if (!isId(id)) throw httpError(404, 'Request not found');
    const t = await SupportTicket.findById(id);
    if (!t) throw httpError(404, 'Request not found');
    if (t.platformUnread) { t.platformUnread = false; await t.save(); }
    const [tenant, owner] = await Promise.all([
        Tenant.findById(t.tenantId).select('name slug phone billing.state status').lean(),
        User.findById(t.userId).select('name phone email').lean(),
    ]);
    return {
        id: t._id, number: t.number, category: t.category, subject: t.subject, status: t.status, priority: t.priority,
        messages: t.messages.map(messageView), createdAt: t.createdAt, lastMessageAt: t.lastMessageAt,
        resolvedAt: t.resolvedAt || null, resolvedBy: t.resolvedBy || null, rating: t.rating?.stars ? t.rating : null, context: t.context || {},
        shop: tenant ? { id: tenant._id, name: tenant.name, slug: tenant.slug, phone: tenant.phone || null, status: tenant.status, billingState: tenant.billing?.state || null } : null,
        owner: owner ? { name: owner.name || null, phone: owner.phone, email: owner.email || null } : null,
    };
}

async function adminReply({ id, body, admin }) {
    if (!isId(id)) throw httpError(404, 'Request not found');
    const t = await SupportTicket.findById(id);
    if (!t) throw httpError(404, 'Request not found');
    const text = cleanText(body?.message);
    const photos = cleanPhotos(body?.photos);
    t.messages.push({ from: 'platform', text, photos, by: admin?.name || 'Support' });
    Object.assign(t, { status: body?.resolve === true ? 'resolved' : 'answered', lastFrom: 'platform', lastMessageAt: new Date(), ownerUnread: true, platformUnread: false });
    if (t.status === 'resolved') { t.resolvedAt = new Date(); t.resolvedBy = 'platform'; }
    await t.save();
    notify.toOwner(t.tenantId, {
        type: 'platform_message', title: `Support: reply to #${t.number}`, body: snippet(text, 140),
        data: { kind: 'support', ticketId: String(t._id) },
    });
    return adminGet(id);
}

async function adminNote({ id, body, admin }) {
    if (!isId(id)) throw httpError(404, 'Request not found');
    const t = await SupportTicket.findById(id);
    if (!t) throw httpError(404, 'Request not found');
    t.messages.push({ from: 'note', text: cleanText(body?.message, 'Note'), by: admin?.name || 'Support' });
    await t.save();   // a note changes nothing for the owner: no status change, no message
    return adminGet(id);
}

async function adminSet({ id, body }) {
    if (!isId(id)) throw httpError(404, 'Request not found');
    const t = await SupportTicket.findById(id);
    if (!t) throw httpError(404, 'Request not found');
    const b = body || {};
    if (b.status === undefined && b.priority === undefined) throw httpError(400, 'Send status and/or priority');
    if (b.status !== undefined) {
        if (!SupportTicket.STATUSES.includes(b.status)) throw httpError(400, 'Unknown status');
        if (b.status === 'resolved' && t.status !== 'resolved') { t.resolvedAt = new Date(); t.resolvedBy = 'platform'; }
        if (b.status !== 'resolved') { t.resolvedAt = undefined; t.resolvedBy = undefined; }
        t.status = b.status;
    }
    if (b.priority !== undefined) {
        if (!SupportTicket.PRIORITIES.includes(b.priority)) throw httpError(400, 'Unknown priority');
        t.priority = b.priority;
    }
    await t.save();
    return adminGet(id);
}

module.exports = {
    getInfo, setInfo, create, ownerList, ownerGet, ownerReply, ownerResolve, ownerRate,
    adminList, adminCounts, adminGet, adminReply, adminNote, adminSet, REOPEN_MS,
};
