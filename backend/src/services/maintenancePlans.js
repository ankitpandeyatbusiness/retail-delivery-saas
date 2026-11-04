// Planned maintenance: tell everybody in advance, pause the chosen shops at the exact time, open them again at the end time (or when you say).
//   create()   plan it: scope (all shops / chosen shops / a brand), start, end (optional), message, who is told
//   tick()     every 30 seconds: send the 24 hour, 1 hour and 15 minute warnings, start what is due, end what is over
//   cancel()   a plan not started yet is cancelled (people are told); a running one is ended now
//   noticeFor() the banner an app shows before the start (read by GET /tenants/config)
// The pause itself is the existing maintenance switch (a shop's, or the whole platform's) with the plan's id on it, so nothing else changes:
// the same 503 answer, the same "Back soon" screen, the same end-time rule.
const mongoose = require('mongoose');
const MaintenancePlan = require('../models/MaintenancePlan');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Brand = require('../models/Brand');
const { httpError } = require('../middlewares/apiErrors');

const MIN = 60000;
const HOUR = 60 * MIN;
const WARN = [['24h', 24 * HOUR], ['1h', HOUR], ['15m', 15 * MIN]];
const NOTICE_WINDOW = 48 * HOUR;

const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const hm = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const span = (p) => (p.endAt ? `from ${when(p.startAt)} to ${hm(p.endAt)}` : `from ${when(p.startAt)}`);

// the shops a plan touches
async function shopsOf(p) {
    const filter = p.scope === 'all' ? {} : { _id: { $in: p.tenantIds } };
    return Tenant.find(filter).select('_id slug').lean();
}
// the shops' apps hear about it at once (the banner appears, or the screen pauses)
async function tell(p) {
    const recog = require('../middlewares/tenantRecognizer');
    for (const t of await shopsOf(p)) { try { recog.invalidateTenant(t.slug); } catch (e) { /* the apps catch up on their own */ } }
}

// ----- who is told -----
async function notifyOne(p, title, body, row, toShop) {
    const center = require('../notifications/center');
    return center.notify('broadcast', {
        tenantId: toShop ? row._id : row.tenantId,
        ...(toShop ? {} : { userId: row._id }),
        title, body, data: { kind: 'maintenance', planId: String(p._id) }, noEmail: true,
        vars: { title, body, kind: 'info', sender: 'Platform', ...(toShop ? {} : { audience: 'shop' }) },
    });
}
async function audienceNotify(p, title, body) {
    const ids = p.scope === 'all' ? null : p.tenantIds;
    const a = p.audience || {};
    let sent = 0;
    const each = async (rows, toShop) => {
        for (let i = 0; i < rows.length; i += 20) {
            const results = await Promise.allSettled(rows.slice(i, i + 20).map((r) => notifyOne(p, title, body, r, toShop)));
            sent += results.filter((x) => x.status === 'fulfilled').length;
        }
    };
    if (a.owners !== false) await each(await Tenant.find({ status: 'active', ...(ids ? { _id: { $in: ids } } : {}) }).select('_id').lean(), true);
    const roles = [...(a.staff !== false ? ['kitchen', 'waiter'] : []), ...(a.riders !== false ? ['rider'] : []), ...(a.customers !== false ? ['customer'] : [])];
    if (roles.length) {
        let last = null;
        for (;;) {
            const q = { role: { $in: roles }, isBlocked: { $ne: true }, ...(ids ? { tenantId: { $in: ids } } : {}), ...(last ? { _id: { $gt: last } } : {}) };
            const page = await User.find(q).sort({ _id: 1 }).limit(200).select('_id tenantId').lean();
            if (!page.length) break;
            await each(page, false);
            last = page[page.length - 1]._id;
        }
    }
    return sent;
}
// each notice is sent once: the plan remembers it (claimed with a filtered update, so a second server or a restart never repeats it)
async function claim(p, mark) {
    const r = await MaintenancePlan.updateOne({ _id: p._id, sent: { $ne: mark } }, { $addToSet: { sent: mark } });
    return r.modifiedCount === 1;
}
const texts = {
    announce: (p) => ({ title: 'Maintenance is planned', body: `${p.message || 'The app will be paused for a short time.'} ${span(p)[0].toUpperCase()}${span(p).slice(1)}. Please finish your work before then.` }),
    '24h': (p) => ({ title: 'Maintenance tomorrow', body: `The app will be paused ${span(p)}. ${p.message || ''}`.trim() }),
    '1h': (p) => ({ title: 'Maintenance in 1 hour', body: `The app will be paused ${span(p)}. Please finish your orders now.` }),
    '15m': (p) => ({ title: 'Maintenance in 15 minutes', body: `The app will be paused at ${hm(p.startAt)}${p.endAt ? ` until ${hm(p.endAt)}` : ''}. Please finish what you are doing.` }),
    start: (p) => ({ title: 'Maintenance has started', body: `${p.message || 'The app is paused for maintenance.'}${p.endAt ? ` Back by ${hm(p.endAt)}.` : ' It opens again when the work is done.'}` }),
    end: () => ({ title: 'We are back', body: 'Maintenance is over. Everything works as usual.' }),
    cancelled: () => ({ title: 'Maintenance cancelled', body: 'The planned maintenance will not happen. Everything works as usual.' }),
};
async function send(p, mark) {
    if (!(await claim(p, mark))) return 0;
    const t = texts[mark](p);
    return audienceNotify(p, t.title, t.body).catch((e) => { console.error('Maintenance notice error:', e.message); return 0; });
}

// ----- the pause -----
async function applyOn(p) {
    const set = { 'maintenance.on': true, 'maintenance.message': p.message || '', 'maintenance.until': p.endAt || null, 'maintenance.planId': String(p._id) };
    if (p.scope === 'all') {
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: set }, { upsert: true });
        require('../middlewares/platformGate').invalidate();
    } else await Tenant.updateMany({ _id: { $in: p.tenantIds } }, { $set: set });
    await tell(p);
}
// only what this plan switched on is switched off (a pause you set by hand meanwhile stays)
async function applyOff(p) {
    const off = { $set: { 'maintenance.on': false }, $unset: { 'maintenance.planId': 1 } };
    if (p.scope === 'all') {
        await PlatformSettings.updateOne({ _id: 'main', 'maintenance.planId': String(p._id) }, off);
        require('../middlewares/platformGate').invalidate();
    } else await Tenant.updateMany({ _id: { $in: p.tenantIds }, 'maintenance.planId': String(p._id) }, off);
    await tell(p);
}

// ----- planning -----
function parseTime(v, label) {
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) throw httpError(400, `${label} is not a valid date and time`);
    return d;
}
async function create(body = {}, by = '') {
    const startAt = parseTime(body.startAt, 'The start');
    const endAt = body.endAt ? parseTime(body.endAt, 'The end') : null;
    const now = Date.now();
    if (startAt.getTime() < now - MIN) throw httpError(400, 'The start must be a time in the future');
    if (endAt && endAt.getTime() <= startAt.getTime()) throw httpError(400, 'The end must be after the start');
    const message = String(body.message || '').trim().slice(0, 200);
    const a = body.audience || {};
    const audience = { owners: a.owners !== false, staff: a.staff !== false, riders: a.riders !== false, customers: a.customers !== false };
    if (!Object.values(audience).some(Boolean)) throw httpError(400, 'Choose at least one group to warn');

    // a warning whose time has already passed when it is planned is not sent (the first notice says it all)
    const doc = { startAt, endAt, message, audience, createdBy: String(by || '').slice(0, 80), sent: WARN.filter(([, before]) => startAt.getTime() - now <= before).map(([m]) => m) };
    if (body.scope === 'all') doc.scope = 'all';
    else if (body.scope === 'brand') {
        if (!mongoose.isValidObjectId(body.brandId)) throw httpError(400, 'Choose the brand');
        const brand = await Brand.findById(body.brandId).select('name').lean();
        if (!brand) throw httpError(404, 'Brand not found');
        const shops = await Tenant.find({ brandId: body.brandId }).select('_id').lean();
        if (!shops.length) throw httpError(400, 'That brand has no branch');
        Object.assign(doc, { scope: 'brand', brandId: body.brandId, brandName: brand.name, tenantIds: shops.map((s) => s._id) });
    } else if (body.scope === 'shops') {
        const ids = Array.isArray(body.tenantIds) ? [...new Set(body.tenantIds)] : [];
        if (!ids.length || ids.length > 200 || !ids.every((x) => mongoose.isValidObjectId(x))) throw httpError(400, 'Choose one or more shops (up to 200)');
        const found = await Tenant.find({ _id: { $in: ids } }).select('_id').lean();
        if (found.length !== ids.length) throw httpError(404, 'A chosen shop was not found');
        Object.assign(doc, { scope: 'shops', tenantIds: found.map((s) => s._id) });
    } else throw httpError(400, 'scope must be all, shops or brand');

    const p = await MaintenancePlan.create(doc);
    if (startAt.getTime() - now > 2 * MIN) {
        await tell(p);                     // the banner shows in the open apps
        send(p, 'announce').catch(() => { });
    }
    return p;
}

async function cancel(id, by = '') {
    const p = mongoose.isValidObjectId(id) ? await MaintenancePlan.findById(id) : null;
    if (!p) throw httpError(404, 'Plan not found');
    if (p.status === 'planned') {
        const r = await MaintenancePlan.updateOne({ _id: p._id, status: 'planned' }, { $set: { status: 'cancelled', endedAt: new Date(), endedBy: by } });
        if (!r.modifiedCount) throw httpError(409, 'It has just started');
        await tell(p);
        if (p.sent.includes('announce')) send({ ...p.toObject(), sent: p.sent.filter((x) => x !== 'cancelled') }, 'cancelled').catch(() => { });
        return MaintenancePlan.findById(p._id);
    }
    if (p.status === 'active') return finish(p, by);
    throw httpError(409, 'It is already over');
}
async function finish(p, by = '') {
    const r = await MaintenancePlan.updateOne({ _id: p._id, status: 'active' }, { $set: { status: 'ended', endedAt: new Date(), endedBy: by } });
    if (!r.modifiedCount) return MaintenancePlan.findById(p._id);
    await applyOff(p);
    send(p, 'end').catch(() => { });
    return MaintenancePlan.findById(p._id);
}

// ----- the clock -----
async function tick(now = Date.now()) {
    const n = new Date(now);
    // warnings for plans not started yet
    const planned = await MaintenancePlan.find({ status: 'planned', startAt: { $gt: n } }).lean();
    for (const p of planned) {
        for (const [mark, before] of WARN) {
            if (p.sent.includes(mark)) continue;
            if (new Date(p.startAt).getTime() - now <= before) await send(p, mark);
        }
    }
    // the ones whose time has come
    for (const due of await MaintenancePlan.find({ status: 'planned', startAt: { $lte: n } }).lean()) {
        const p = await MaintenancePlan.findOneAndUpdate({ _id: due._id, status: 'planned' }, { $set: { status: 'active', startedAt: n } }, { returnDocument: 'after' });
        if (!p) continue;
        await applyOn(p);
        send(p, 'start').catch(() => { });
    }
    // the ones that are over
    for (const over of await MaintenancePlan.find({ status: 'active', endAt: { $lte: n } }).lean()) await finish(over, 'automatic');
}

function start() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await tick(); } catch (e) { console.error('Maintenance plans job error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 20 * 1000).unref?.();
    setInterval(run, 30 * 1000).unref?.();
}

// ----- reading -----
const view = (p) => ({
    id: String(p._id), scope: p.scope, brandName: p.brandName || '', shops: p.scope === 'all' ? 0 : (p.tenantIds || []).length, startAt: p.startAt, endAt: p.endAt || null,
    message: p.message || '', audience: p.audience, status: p.status, sent: p.sent, createdBy: p.createdBy || '', startedAt: p.startedAt || null, endedAt: p.endedAt || null,
});
async function list() {
    const rows = await MaintenancePlan.find({}).sort({ startAt: -1 }).limit(40).lean();
    const names = new Map((await Tenant.find({ _id: { $in: [...new Set(rows.filter((r) => r.scope === 'shops').flatMap((r) => r.tenantIds.slice(0, 3)))] } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    return rows.map((r) => ({ ...view(r), shopNames: r.scope === 'shops' ? r.tenantIds.slice(0, 3).map((id) => names.get(String(id))).filter(Boolean) : [] }));
}
// the banner for one shop's apps: the next planned maintenance that touches it, within 48 hours
async function noticeFor(tenantId, now = Date.now()) {
    const p = await MaintenancePlan.findOne({
        status: 'planned', startAt: { $gt: new Date(now), $lt: new Date(now + NOTICE_WINDOW) }, sent: 'announce',
        $or: [{ scope: 'all' }, { tenantIds: tenantId }],
    }).sort({ startAt: 1 }).lean();
    return p ? { message: p.message || '', startAt: p.startAt, endAt: p.endAt || null } : null;
}

module.exports = { create, cancel, tick, start, list, noticeFor, view, texts };
