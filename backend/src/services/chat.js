// The chat between a customer and the shop's owner about one bulk order, one service inquiry or one table booking (like WhatsApp):
// text, pictures and voice notes, shown live, with ticks: sent (saved), delivered (the other person's app has it), read (he opened the chat).
// A chat closes by itself some days after the thing it is about is over (3 days for a bulk order and a booking). A service inquiry has no timer of its own: its chat
// is open until the inquiry is closed, by the owner or by his "close quiet inquiries" rule (Off, 3, 7 or 14 days after the last word of an inquiry he has answered;
// an inquiry nobody has answered never closes by itself, so he can always still reply). A closed chat can be read, not written to. Only the customer and the owner talk here.
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
const DELETE_ALL_MS = 2 * DAY;   // "delete for everyone": only your own message, and only for 2 days after you sent it (like WhatsApp)
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
    return d.status === 'closed' ? new Date(0) : null;   // an inquiry: closed when the owner ended it (he can open it again); see inquiryCloses for the projected time
}

const QUIET_STATUSES = ['replied', 'quoted', 'confirmed', 'rejected'];   // an inquiry the owner has answered (the same list the automation uses)
// WHEN an inquiry's chat will close by itself, for the "closes in N days" note: null = it will not (unanswered, or the owner switched the rule off)
async function inquiryCloses(doc, tenant) {
    if (doc.status === 'closed') return new Date(0);
    if (!QUIET_STATUSES.includes(doc.status)) return null;
    const days = (await require('./automations').get(tenant._id))?.inquiryCloseDays;
    if (!days) return null;
    return new Date(new Date(doc.lastMessageAt || doc.updatedAt || doc.createdAt).getTime() + days * DAY);
}
const titleOf = (kind, d) => (kind === 'bulk' ? `Bulk order ${d.code}` : kind === 'inquiry' ? d.serviceName : `Table booking · ${d.date} ${d.time}`);

// the thing the chat is about, and whether this person may talk about it
async function load({ tenant, kind, refId, side, userId }) {
    const Model = MODELS[kind];
    if (!Model || !mongoose.isValidObjectId(String(refId))) throw httpError(404, 'Chat not found');
    const doc = await Model.findOne({ _id: refId, tenantId: tenant._id });
    if (!doc || (side === 'customer' && String(doc.userId) !== String(userId))) throw httpError(404, 'Chat not found');
    const closes = kind === 'inquiry' ? await inquiryCloses(doc, tenant) : closesAt(kind, doc);
    // an inquiry is closed only when its status says so (the rule that closes quiet ones changes the status); the others close at their time
    const closed = kind === 'inquiry' ? doc.status === 'closed' : (!!closes && closes.getTime() <= Date.now());
    return { doc, customerId: doc.userId, closes, closed, title: titleOf(kind, doc) };
}

const view = (m, side) => (m.deletedAll ? {
    id: String(m._id), from: m.from, mine: m.from === side, text: '', images: [], voice: null, at: m.createdAt, deleted: true,
    status: m.from === side ? (m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent') : undefined,
    ...(m.from === side && m.clientId ? { clientId: m.clientId } : {}),
} : {
    id: String(m._id), from: m.from, mine: m.from === side, text: m.text || '', images: m.images || [], voice: m.voice?.url ? { url: m.voice.url, sec: m.voice.sec || 0 } : null,
    at: m.createdAt, status: m.from === side ? (m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent') : undefined,
    // the sender's own phone matches the server's copy to the bubble it showed while sending (so there is never a twin bubble)
    ...(m.from === side && m.clientId ? { clientId: m.clientId } : {}),
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
    // his other phone or browser learns it too (the badges, the Home card of inquiries waiting): a read note about messages that are not his own changes no tick. Every kind of chat, not only inquiries.
    tell(side, tenant._id, customerId, 'chat:status', { kind, refId: String(refId), ids: [], status: 'read', echo: true });
    return rows.length;
}

async function list({ tenant, kind, refId, side, userId, read }) {
    const c = await load({ tenant, kind, refId, side, userId });
    await markDelivered({ tenant, kind, refId, side, customerId: c.customerId });   // he fetched it: it has reached his phone
    if (read) await markRead({ tenant, kind, refId, side, customerId: c.customerId });
    const rows = await ChatMessage.find({ tenantId: tenant._id, kind, refId, deletedFor: { $ne: side } }).sort({ createdAt: -1 }).limit(150).lean();
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

// An unread message that is deleted must not keep the badge of the inquiry list up
async function dropUnread(kind, refId, forSide) {
    if (kind !== 'inquiry') return;
    const field = forSide === 'owner' ? 'ownerUnread' : 'customerUnread';
    await ServiceInquiry.updateOne({ _id: refId, [field]: { $gt: 0 } }, { $inc: { [field]: -1 } });
}

// Delete a message.  scope 'me': it disappears for this person only (any message, also in a closed chat).
//                    scope 'all': only your own message, while the chat is open and for 2 days after it was sent. Its words, pictures and voice are removed for both of you;
//                                 a note "This message was deleted" stays, so the order of the chat and its ticks do not change.
async function remove({ tenant, kind, refId, side, userId, messageId, scope }) {
    if (scope !== 'me' && scope !== 'all') throw httpError(400, 'scope must be "me" or "all"');
    const c = await load({ tenant, kind, refId, side, userId });
    if (!mongoose.isValidObjectId(String(messageId))) throw httpError(404, 'Message not found');
    const m = await ChatMessage.findOne({ _id: messageId, tenantId: tenant._id, kind, refId: c.doc._id });
    if (!m || (m.deletedFor || []).includes(side)) throw httpError(404, 'Message not found');
    const them = other(side);
    const unreadForThem = m.from === side && !m.readAt && !m.deletedAll;
    const unreadForMe = m.from === them && !m.readAt && !m.deletedAll;
    const ev = (s) => ({ kind, refId: String(c.doc._id), ids: [String(m._id)], scope: s });
    if (scope === 'me') {
        await ChatMessage.updateOne({ _id: m._id }, { $addToSet: { deletedFor: side } });
        if (unreadForMe) await dropUnread(kind, c.doc._id, side);
        tell(side, tenant._id, c.customerId, 'chat:deleted', ev('me'));   // his other phone
        return { ok: true, id: String(m._id), scope };
    }
    if (m.from !== side) throw httpError(403, 'You can only delete your own messages for everyone');
    if (c.closed) throw httpError(409, 'This chat is closed.');
    if (m.deletedAll) return { ok: true, id: String(m._id), scope };   // already done
    if (Date.now() - new Date(m.createdAt).getTime() > DELETE_ALL_MS) throw httpError(409, 'This message is too old to delete for everyone');
    await ChatMessage.updateOne({ _id: m._id }, { $set: { text: '', deletedAll: true, deletedAllAt: new Date() }, $unset: { images: 1, voice: 1 } });
    if (unreadForThem) await dropUnread(kind, c.doc._id, them);
    tell(them, tenant._id, c.customerId, 'chat:deleted', ev('all'));
    tell(side, tenant._id, c.customerId, 'chat:deleted', ev('all'));
    return { ok: true, id: String(m._id), scope };
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
    const match = { tenantId: tenant._id, from: other(side), readAt: { $exists: false }, deletedAll: { $ne: true }, deletedFor: { $ne: side }, ...(side === 'customer' ? { customerId: new mongoose.Types.ObjectId(String(userId)) } : {}) };
    const rows = await ChatMessage.aggregate([{ $match: match }, { $group: { _id: { k: '$kind', r: '$refId' }, n: { $sum: 1 } } }]);
    const byRef = Object.fromEntries(rows.map((r) => [`${r._id.k}:${r._id.r}`, r.n]));
    return { total: rows.reduce((a, r) => a + r.n, 0), byRef };
}

module.exports = { load, list, send, remove, markRead, markDelivered, typing, unread, closesAt, view, DELETE_ALL_MS };
