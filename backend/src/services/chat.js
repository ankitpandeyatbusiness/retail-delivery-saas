// The chat between a customer and the shop's owner about one bulk order, one service inquiry or one table booking (like WhatsApp):
// text, pictures and voice notes, shown live, with ticks: sent (saved), delivered (the other person's app has it), read (he opened the chat).
// A chat closes by itself some days after the thing it is about is over (3 days for a bulk order and a booking, 7 days after the last message for
// a service inquiry); a closed chat can be read, not written to. Only the customer and the owner talk here.
const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const BulkOrder = require('../models/BulkOrder');
const ServiceInquiry = require('../models/ServiceInquiry');
const TableBooking = require('../models/TableBooking');
const realtime = require('./realtime');
const { httpError } = require('../middlewares/apiErrors');

const DAY = 86400000;
const MODELS = { bulk: BulkOrder, inquiry: ServiceInquiry, booking: TableBooking };
const ENDED_BULK = ['delivered', 'completed', 'cancelled', 'declined', 'expired'];
const URL_RE = /^https?:\/\/\S{3,500}$/;
const other = (side) => (side === 'owner' ? 'customer' : 'owner');

// when does the chat close? null = not decided yet (a bulk order still going on)
function closesAt(kind, d) {
    if (kind === 'bulk') {
        if (!ENDED_BULK.includes(d.status)) return null;
        return new Date(new Date(d.completedAt || d.stageAt?.delivered || d.updatedAt || d.createdAt).getTime() + 3 * DAY);
    }
    if (kind === 'booking') {
        const base = ['cancelled', 'expired', 'no_show'].includes(d.status) ? (d.cancelledAt || d.updatedAt) : (d.endsAt || d.startsAt);
        return new Date(new Date(base).getTime() + 3 * DAY);
    }
    return new Date(new Date(d.lastMessageAt || d.updatedAt || d.createdAt).getTime() + 7 * DAY);   // a service inquiry: 7 days after the last word
}
const titleOf = (kind, d) => (kind === 'bulk' ? `Bulk order ${d.code}` : kind === 'inquiry' ? d.serviceName : `Table booking · ${d.date} ${d.time}`);

// the thing the chat is about, and whether this person may talk about it
async function load({ tenant, kind, refId, side, userId }) {
    const Model = MODELS[kind];
    if (!Model || !mongoose.isValidObjectId(String(refId))) throw httpError(404, 'Chat not found');
    const doc = await Model.findOne({ _id: refId, tenantId: tenant._id });
    if (!doc || (side === 'customer' && String(doc.userId) !== String(userId))) throw httpError(404, 'Chat not found');
    const closes = closesAt(kind, doc);
    return { doc, customerId: doc.userId, closes, closed: !!closes && closes.getTime() <= Date.now(), title: titleOf(kind, doc) };
}

const view = (m, side) => ({
    id: String(m._id), from: m.from, mine: m.from === side, text: m.text || '', images: m.images || [], voice: m.voice?.url ? { url: m.voice.url, sec: m.voice.sec || 0 } : null,
    at: m.createdAt, status: m.from === side ? (m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent') : undefined,
});

function tell(side, tenantId, customerId, event, payload) {
    if (side === 'owner') realtime.toOwner(tenantId, event, payload); else realtime.toUser(tenantId, customerId, event, payload);
}

// an old inquiry kept its words in the inquiry itself: they show first, as read
const legacy = (kind, doc, side) => (kind !== 'inquiry' ? [] : (doc.messages || []).map((m, i) => ({
    id: `legacy-${i}`, from: m.from, mine: m.from === side, text: m.text || '', images: m.images || [], voice: null, at: m.at, status: m.from === side ? 'read' : undefined, legacy: true,
})));

async function markDelivered({ tenant, kind, refId, side, customerId, ids }) {
    const filter = { tenantId: tenant._id, kind, refId, from: other(side), deliveredAt: { $exists: false }, ...(ids ? { _id: { $in: ids.filter((x) => mongoose.isValidObjectId(x)) } } : {}) };
    const rows = await ChatMessage.find(filter).select('_id').lean();
    if (!rows.length) return [];
    await ChatMessage.updateMany({ _id: { $in: rows.map((r) => r._id) }, deliveredAt: { $exists: false } }, { $set: { deliveredAt: new Date() } });
    tell(other(side), tenant._id, customerId, 'chat:status', { kind, refId: String(refId), ids: rows.map((r) => String(r._id)), status: 'delivered' });
    return rows;
}

async function markRead({ tenant, kind, refId, side, customerId }) {
    const rows = await ChatMessage.find({ tenantId: tenant._id, kind, refId, from: other(side), readAt: { $exists: false } }).select('_id').lean();
    if (rows.length) {
        const now = new Date();
        const ids = rows.map((r) => r._id);
        await ChatMessage.updateMany({ _id: { $in: ids }, deliveredAt: { $exists: false } }, { $set: { deliveredAt: now } });
        await ChatMessage.updateMany({ _id: { $in: ids }, readAt: { $exists: false } }, { $set: { readAt: now } });
        tell(other(side), tenant._id, customerId, 'chat:status', { kind, refId: String(refId), ids: ids.map(String), status: 'read' });
    }
    if (kind === 'inquiry') await ServiceInquiry.updateOne({ _id: refId }, { $set: side === 'owner' ? { ownerUnread: 0 } : { customerUnread: 0 } });   // the inquiry list badges
    return rows.length;
}

async function list({ tenant, kind, refId, side, userId, read }) {
    const c = await load({ tenant, kind, refId, side, userId });
    await markDelivered({ tenant, kind, refId, side, customerId: c.customerId });   // he fetched it: it has reached his phone
    if (read) await markRead({ tenant, kind, refId, side, customerId: c.customerId });
    const rows = await ChatMessage.find({ tenantId: tenant._id, kind, refId }).sort({ createdAt: -1 }).limit(150).lean();
    const items = [...legacy(kind, c.doc, side), ...rows.reverse().map((m) => view(m, side))].sort((a, b) => new Date(a.at) - new Date(b.at));
    return { items, closed: c.closed, closesAt: c.closes, title: c.title };
}

async function send({ tenant, kind, refId, side, userId, body = {} }) {
    const c = await load({ tenant, kind, refId, side, userId });
    if (c.closed) throw httpError(409, 'This chat is closed.');
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';
    const images = Array.isArray(body.images) ? body.images.filter((u) => typeof u === 'string' && URL_RE.test(u)).slice(0, 4) : [];
    const sec = Number(body.voice?.sec);
    const voice = body.voice && typeof body.voice.url === 'string' && URL_RE.test(body.voice.url) ? { url: body.voice.url, sec: Math.max(1, Math.min(120, Math.round(sec) || 1)) } : undefined;
    if (!text && !images.length && !voice) throw httpError(400, 'Write a message, or add a picture or a voice note');
    const clientId = typeof body.clientId === 'string' && body.clientId.length <= 60 ? body.clientId : undefined;
    let m;
    try {
        m = await ChatMessage.create({ tenantId: tenant._id, kind, refId, customerId: c.customerId, from: side, senderId: userId, text, ...(images.length ? { images } : {}), ...(voice ? { voice } : {}), clientId });
    } catch (e) {
        if (e.code !== 11000) throw e;
        m = await ChatMessage.findOne({ refId, clientId });   // the same message sent twice: saved once
        return view(m, side);
    }
    if (kind === 'inquiry') {   // the inquiry list (unread badge, last word, replied)
        await ServiceInquiry.updateOne({ _id: refId }, { $set: { lastMessageAt: m.createdAt, ...(side === 'owner' && c.doc.status === 'new' ? { status: 'replied' } : {}) }, $inc: side === 'owner' ? { customerUnread: 1 } : { ownerUnread: 1 } });
    }
    const them = other(side);
    tell(them, tenant._id, c.customerId, 'chat:message', { kind, refId: String(refId), title: c.title, message: view(m, them) });
    tell(side, tenant._id, c.customerId, 'chat:message', { kind, refId: String(refId), title: c.title, message: view(m, side), echo: true });   // his other phone
    // a notification for the other person, once for a burst of messages (the app stays quiet while that chat is open)
    const burst = await ChatMessage.countDocuments({ tenantId: tenant._id, kind, refId, from: side, readAt: { $exists: false }, createdAt: { $gte: new Date(Date.now() - 45000) }, _id: { $ne: m._id } });
    if (!burst) {
        const what = text || (voice ? 'Voice message' : 'Photo');
        require('../notifications/center').notify('chat_message', {
            tenantId: tenant._id, ...(them === 'customer' ? { userId: c.customerId } : {}),
            vars: { name: side === 'customer' ? (c.doc.contact?.name || c.doc.name || 'The customer') : (tenant.name || 'The shop'), title: c.title, text: what.slice(0, 100), audience: them },
            data: { kind: 'chat', chatKind: kind, refId: String(refId), ...(kind === 'bulk' ? { bulkId: String(refId) } : kind === 'inquiry' ? { inquiryId: String(refId) } : { bookingId: String(refId) }) },
        });
    }
    return view(m, side);
}

const typingAt = new Map();
function typing({ tenant, kind, refId, side, customerId }) {
    const key = `${kind}:${refId}:${side}`;
    const now = Date.now();
    if ((typingAt.get(key) || 0) > now - 1500) return false;
    typingAt.set(key, now);
    if (typingAt.size > 2000) for (const [k, t] of typingAt) if (t < now - 60000) typingAt.delete(k);
    tell(other(side), tenant._id, customerId, 'chat:typing', { kind, refId: String(refId), from: side });
    return true;
}

// how many unread messages, per chat (for the badges on the lists)
async function unread({ tenant, side, userId }) {
    const match = { tenantId: tenant._id, from: other(side), readAt: { $exists: false }, ...(side === 'customer' ? { customerId: new mongoose.Types.ObjectId(String(userId)) } : {}) };
    const rows = await ChatMessage.aggregate([{ $match: match }, { $group: { _id: { k: '$kind', r: '$refId' }, n: { $sum: 1 } } }]);
    const byRef = Object.fromEntries(rows.map((r) => [`${r._id.k}:${r._id.r}`, r.n]));
    return { total: rows.reduce((a, r) => a + r.n, 0), byRef };
}

module.exports = { load, list, send, markRead, markDelivered, typing, unread, closesAt, view };
