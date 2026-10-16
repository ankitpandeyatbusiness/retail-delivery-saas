// Messages to many people.
//   owner      -> his customers, his riders, or both  (kind "info" or "promo")
//   superadmin -> the owners of all shops, or of chosen shops (kind "info")
// Never by SMS. 5 broadcasts per day per sender. A promo skips customers who switched promotions off.
// The sending runs in the background, 500 people at a time, through the notification center.
const mongoose = require('mongoose');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const Broadcast = require('../models/Broadcast');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const center = require('../notifications/center');
const liveFeed = require('./liveFeed');
const { httpError } = require('../middlewares/apiErrors');

const DAILY_LIMIT = 5;
const PAGE = 500;
const PARALLEL = 25;
const SHOP_ROLES = { customers: ['customer'], riders: ['rider'], both: ['customer', 'rider'] };

let limiter = null;
const getLimiter = () => {
    if (!limiter) {
        limiter = new RateLimiterMongo({ storeClient: mongoose.connection, points: DAILY_LIMIT, duration: 24 * 3600, keyPrefix: 'rl_msg' });
    }
    return limiter;
};
async function takeSlot(actor) {
    try {
        await getLimiter().consume(`msg:${actor.type}:${actor.id}`);
    } catch (rej) {
        if (rej instanceof Error) throw httpError(503, 'Service unavailable');
        throw httpError(429, `You can send ${DAILY_LIMIT} broadcasts a day. Try again tomorrow.`);
    }
}

function parseContent(b = {}) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (!title || title.length > 120) throw httpError(400, 'Title is needed (up to 120 characters)');
    if (!body || body.length > 1000) throw httpError(400, 'Message is needed (up to 1000 characters)');
    const kind = b.kind === undefined ? 'info' : b.kind;
    if (!['info', 'promo'].includes(kind)) throw httpError(400, 'kind must be "info" or "promo"');
    if (b.sendEmail !== undefined && typeof b.sendEmail !== 'boolean') throw httpError(400, 'sendEmail must be true or false');
    return { title, body, kind, sendEmail: b.sendEmail === true };
}

// who gets an owner broadcast
function shopFilter(b) {
    const f = { tenantId: b.tenantId, role: { $in: SHOP_ROLES[b.audience] }, isBlocked: { $ne: true } };
    if (b.kind === 'promo') f['prefs.promotions'] = { $ne: false };
    return f;
}
// who gets a superadmin broadcast: the shops (the owner side of each shop is one inbox)
const tenantFilter = (b) => ({ status: 'active', ...(b.tenantIds?.length ? { _id: { $in: b.tenantIds } } : {}) });

const view = (b) => ({
    id: b._id, title: b.title, body: b.body, kind: b.kind, audience: b.audience, sendEmail: !!b.sendEmail,
    status: b.status, recipients: b.recipients, skippedOptOut: b.skippedOptOut, sent: b.sent, failed: b.failed,
    createdAt: b.createdAt, finishedAt: b.finishedAt || null,
});

async function create(draft) {
    const doc = await Broadcast.create(draft);
    setImmediate(() => deliver(doc._id).catch((e) => console.error('Broadcast error:', e.message)));
    return doc;
}

async function startShop({ tenant, actor, body }) {
    const content = parseContent(body);
    content.sendEmail = false;   // email is kept for the platform's official documents: a shop reaches its people by push and the in-app inbox
    const audience = body?.audience === undefined ? 'customers' : body.audience;
    if (!SHOP_ROLES[audience]) throw httpError(400, 'audience must be "customers", "riders" or "both"');
    if (content.kind === 'promo' && audience !== 'customers') throw httpError(400, 'Promotions can go to customers only');

    const draft = {
        senderType: actor.type === 'superadmin' ? 'superadmin' : 'owner', senderId: actor.id,
        senderLabel: String(tenant.name || '').slice(0, 80), tenantId: tenant._id, audience, ...content,
    };
    const recipients = await User.countDocuments(shopFilter(draft));
    if (!recipients) throw httpError(400, 'There is nobody to send this to');
    const skippedOptOut = content.kind === 'promo'
        ? await User.countDocuments({ tenantId: tenant._id, role: 'customer', isBlocked: { $ne: true }, 'prefs.promotions': false })
        : 0;

    await takeSlot(actor);
    const doc = await create({ ...draft, recipients, skippedOptOut });
    liveFeed.emit(tenant._id, 'messages', { type: 'message.sent', audience, kind: content.kind, recipients });
    return doc;
}

async function startPlatform({ admin, body }) {
    const content = parseContent(body);
    if (content.kind !== 'info') throw httpError(400, 'The platform sends information messages only');
    let tenantIds = [];
    if (body?.tenantIds !== undefined) {
        if (!Array.isArray(body.tenantIds) || body.tenantIds.length > 200 || !body.tenantIds.every((x) => typeof x === 'string' && mongoose.isValidObjectId(x))) {
            throw httpError(400, 'tenantIds must be a list of shop ids');
        }
        tenantIds = [...new Set(body.tenantIds)];
    }
    const draft = {
        senderType: 'superadmin', senderId: admin._id, senderLabel: 'Platform', audience: 'owners', tenantIds, ...content,
    };
    const recipients = await Tenant.countDocuments(tenantFilter(draft));
    if (!recipients) throw httpError(400, 'There is no shop to send this to');

    await takeSlot({ type: 'superadmin', id: admin._id });
    return create({ ...draft, recipients });
}

function sendOne(b, row) {
    const toShop = b.audience === 'owners';
    return center.notify('broadcast', {
        tenantId: toShop ? row._id : row.tenantId,
        ...(toShop ? {} : { userId: row._id }),   // no userId = the owner side of the shop
        title: b.title,
        body: b.body,
        data: { broadcastId: String(b._id), kind: b.kind },
        noEmail: !b.sendEmail,
        vars: { title: b.title, body: b.body, kind: b.kind, sender: b.senderLabel, ...(toShop ? {} : { audience: 'shop' }) },
    });
}

// Runs once per broadcast (the claim makes a second run do nothing)
async function deliver(id) {
    const b = await Broadcast.findOneAndUpdate(
        { _id: id, status: 'queued' }, { $set: { status: 'sending', startedAt: new Date() } }, { returnDocument: 'after' },
    ).lean();
    if (!b) return;

    const toShops = b.audience === 'owners';
    const Model = toShops ? Tenant : User;
    let sent = 0;
    let failed = 0;
    let last = null;
    try {
        for (; ;) {
            const filter = toShops ? tenantFilter(b) : shopFilter(b);
            if (last) filter._id = { ...(filter._id || {}), $gt: last };
            const page = await Model.find(filter).sort({ _id: 1 }).limit(PAGE).select('_id tenantId').lean();
            if (!page.length) break;
            last = page[page.length - 1]._id;
            for (let i = 0; i < page.length; i += PARALLEL) {
                const results = await Promise.allSettled(page.slice(i, i + PARALLEL).map((row) => sendOne(b, row)));
                for (const r of results) {
                    if (r.status === 'fulfilled' && r.value) sent += 1; else failed += 1;
                }
            }
        }
        await Broadcast.updateOne({ _id: id }, { $set: { status: 'done', sent, failed, finishedAt: new Date() } });
    } catch (e) {
        console.error('Broadcast failed:', e.message);
        await Broadcast.updateOne({ _id: id }, { $set: { status: 'failed', sent, failed, finishedAt: new Date() } }).catch(() => { });
    }
}

const list = async (filter, limit = 20) => (await Broadcast.find(filter).sort({ createdAt: -1 }).limit(limit).lean()).map(view);

module.exports = { startShop, startPlatform, deliver, list, view, DAILY_LIMIT };