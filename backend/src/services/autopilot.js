// Autopilot: reminders to a shop's customers that go out by themselves, push and in-app inbox only (never SMS, never email).
// Also the one-tap "Remind" for a single customer, which follows the same safety rules.
//
// The seatbelt (always on, the owner cannot switch it off):
//   - never to a blocked customer or one who turned off offers
//   - never to someone who ordered in the last 24 hours
//   - not at night (quiet hours, India time)
//   - at most 2 / 3 / 4 promotional messages a week to one customer (gentle / normal / pushy), a day or more apart
//   - a win-back sequence is three messages at most, then the customer is left alone for 30 days; an order stops it at once
//   - the platform can switch Autopilot off for a shop (platformPaused) or for everybody (PlatformSettings.insights.autopilotEnabled)
const mongoose = require('mongoose');
const Autopilot = require('../models/Autopilot');
const NudgeLog = require('../models/NudgeLog');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const Notification = require('../models/Notification');
const PlatformSettings = require('../models/PlatformSettings');
const center = require('../notifications/center');
const insights = require('./customerInsights');
const msgs = require('./nudgeMessages');
const closingReport = require('./closingReport');
const businessReport = require('./businessReport');
const { httpError } = require('../middlewares/apiErrors');

const DAY = 86400000;
const IST = 330 * 60000;
const AUTOMATIONS = ['welcome', 'thanks', 'winback', 'mealtime', 'festival', 'dailySummary', 'weeklyDigest'];
const RECOMMENDED = {
    on: { welcome: true, thanks: true, winback: true, mealtime: false, festival: false, dailySummary: true, weeklyDigest: true },
    frequency: 'gentle', language: 'hinglish', maxDiscount: 10, quietFrom: 21, quietTo: 9, summaryHour: 22,
};
const WEEKLY_CAP = { gentle: 2, normal: 3, pushy: 4 };
const SPACING_DAYS = { gentle: 3, normal: 2, pushy: 1 };      // days between two promotional messages to one customer
const WINBACK_GAPS = { gentle: [0, 7, 14], normal: [0, 3, 7], pushy: [0, 2, 4] };   // days after the previous step
const REST_DAYS = 30;
const MANUAL_SPACING_DAYS = 3;
// Festival days the greeting goes out (month-day, or a full date for the ones that move). Hours: 11 AM.
const FESTIVALS = [
    { date: '01-01', name: 'New Year' }, { date: '01-26', name: 'Republic Day' }, { date: '08-15', name: 'Independence Day' },
    { date: '12-25', name: 'Christmas' }, { date: '2026-10-20', name: 'Dussehra' }, { date: '2026-11-08', name: 'Diwali' },
];

const istHour = (d) => new Date(d.getTime() + IST).getUTCHours();
const istDate = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const istDayStart = (d) => new Date(Date.parse(`${istDate(d)}T00:00:00+05:30`));
const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const inQuiet = (hour, from, to) => (from === to ? false : from > to ? hour >= from || hour < to : hour >= from && hour < to);

/* ----------------------------- the shop's settings ----------------------------- */
const view = (doc) => {
    const d = doc || {};
    return {
        on: Object.fromEntries(AUTOMATIONS.map((k) => [k, !!d.on?.[k]])),
        frequency: d.frequency || RECOMMENDED.frequency, language: d.language || RECOMMENDED.language,
        maxDiscount: d.maxDiscount ?? RECOMMENDED.maxDiscount, quietFrom: d.quietFrom ?? RECOMMENDED.quietFrom,
        quietTo: d.quietTo ?? RECOMMENDED.quietTo, summaryHour: d.summaryHour ?? RECOMMENDED.summaryHour,
        custom: d.custom || {}, platformPaused: !!d.platformPaused, configured: !!doc,
    };
};

async function getConfig(tenantId) {
    const doc = await Autopilot.findOne({ tenantId }).lean();
    const v = view(doc);
    if (!doc) v.on = Object.fromEntries(AUTOMATIONS.map((k) => [k, false]));   // nothing runs until the owner turns it on
    return v;
}

const intIn = (v, min, max, name) => {
    if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${name} must be a whole number from ${min} to ${max}`);
    return v;
};

async function saveConfig(tenantId, body = {}) {
    const set = {};
    if (body.recommended === true) {
        // "Turn on recommended" / "Reset to recommended": the recommended automations on, the rest off, every number back
        Object.entries(RECOMMENDED.on).forEach(([k, v]) => { set[`on.${k}`] = v; });
        ['frequency', 'language', 'maxDiscount', 'quietFrom', 'quietTo', 'summaryHour'].forEach((k) => { set[k] = RECOMMENDED[k]; });
        set.custom = {};
    } else {
        if (body.on !== undefined) {
            if (!body.on || typeof body.on !== 'object') throw httpError(400, 'on must be an object');
            for (const [k, v] of Object.entries(body.on)) {
                if (!AUTOMATIONS.includes(k)) throw httpError(400, `Unknown automation: ${k}`);
                if (typeof v !== 'boolean') throw httpError(400, `${k} must be true or false`);
                set[`on.${k}`] = v;
            }
        }
        if (body.frequency !== undefined) { if (!WEEKLY_CAP[body.frequency]) throw httpError(400, 'frequency must be gentle, normal or pushy'); set.frequency = body.frequency; }
        if (body.language !== undefined) { if (!msgs.LANGUAGES.includes(body.language)) throw httpError(400, 'language must be en, hinglish or hi'); set.language = body.language; }
        if (body.maxDiscount !== undefined) set.maxDiscount = intIn(body.maxDiscount, 0, 50, 'maxDiscount');
        if (body.quietFrom !== undefined) set.quietFrom = intIn(body.quietFrom, 0, 23, 'quietFrom');
        if (body.quietTo !== undefined) set.quietTo = intIn(body.quietTo, 0, 23, 'quietTo');
        if (body.summaryHour !== undefined) set.summaryHour = intIn(body.summaryHour, 0, 23, 'summaryHour');
        if (body.custom !== undefined) {
            if (!body.custom || typeof body.custom !== 'object') throw httpError(400, 'custom must be an object');
            for (const [k, v] of Object.entries(body.custom)) {
                if (!msgs.KINDS.includes(k)) throw httpError(400, `Unknown message: ${k}`);
                if (v === null) { set[`custom.${k}`] = null; continue; }
                const title = typeof v?.title === 'string' ? v.title.trim() : '';
                const text = typeof v?.body === 'string' ? v.body.trim() : '';
                if (!title || title.length > 60) throw httpError(400, 'The title is needed and can be up to 60 letters');
                if (!text || text.length > 200) throw httpError(400, 'The message is needed and can be up to 200 letters');
                set[`custom.${k}`] = { title, body: text };
            }
        }
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    // a null in custom means "remove my own wording"
    const unset = {};
    Object.keys(set).forEach((k) => { if (k.startsWith('custom.') && set[k] === null) { unset[k] = ''; delete set[k]; } });
    await Autopilot.findOneAndUpdate(
        { tenantId },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { tenantId } },
        { upsert: true, setDefaultsOnInsert: true },
    );
    return getConfig(tenantId);
}

/* ------------------------------- sending one message ------------------------------- */
async function recentIdx(tenantId, userId, kind) {
    const logs = await NudgeLog.find({ tenantId, userId, kind, createdAt: { $gte: new Date(Date.now() - 30 * DAY) } }).select('messageIdx').lean();
    return logs.map((l) => l.messageIdx).filter((n) => Number.isInteger(n) && n >= 0);
}

// why NOT to message this customer now (null = fine). profile = customerInsights profile. who = 'owner' | 'autopilot'.
async function holdBack({ tenantId, user, profile, cfg, now, who }) {
    if (user.isBlocked) return 'This customer is blocked.';
    if (user.prefs?.promotions === false) return 'He turned off offers, so we do not message him.';
    if (profile && now.getTime() - new Date(profile.lastOrderAt).getTime() < DAY) return 'He ordered in the last 24 hours.';
    if (inQuiet(istHour(now), cfg.quietFrom, cfg.quietTo)) return `It is quiet time (${cfg.quietFrom}:00 to ${cfg.quietTo}:00). Customers are not messaged at night.`;
    const week = await NudgeLog.find({ tenantId, userId: user._id, promo: true, createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } }).select('createdAt by').sort({ createdAt: -1 }).lean();
    if (week.length >= WEEKLY_CAP[cfg.frequency]) return 'He already got enough messages this week.';
    const gap = who === 'owner' ? MANUAL_SPACING_DAYS : SPACING_DAYS[cfg.frequency];
    if (week[0] && now.getTime() - new Date(week[0].createdAt).getTime() < gap * DAY) return `He was messaged recently. Wait ${gap} days between messages.`;
    return null;
}

async function makeCoupon(tenantId, pct, now) {
    for (let i = 0; i < 4; i += 1) {
        const code = `BACK${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        try {
            await Coupon.create({
                tenantId, code, description: 'Comeback offer (Autopilot)', discountType: 'percent', discountValue: pct, maxDiscount: 200,
                usageLimitPerUser: 1, totalUsageLimit: 1, isPublic: false, endsAt: new Date(now.getTime() + 5 * DAY), isActive: true,
            });
            return code;
        } catch (e) { if (e.code !== 11000) throw e; }
    }
    return null;
}

// builds, records and sends one message. Returns { title, body } or null when it could not be claimed.
async function deliver({ tenant, user, profile, cfg, kind, libKind, by, promo = true, orderId, couponCode, override, now, food, extraVars }) {
    const avoid = await recentIdx(tenant._id, user._id, kind);
    const vars = { name: user.name, shop: tenant.name, food: food || profile?.favourites?.[0]?.name || '', discount: cfg.maxDiscount, code: couponCode || '', ...(extraVars || {}) };
    const m = override?.title && override?.body
        ? { title: String(override.title).slice(0, 120), body: String(override.body).slice(0, 300), idx: -1 }
        : msgs.build({ kind: libKind || kind, lang: cfg.language, avoid, custom: cfg.custom?.[libKind || kind], vars });
    try {
        await NudgeLog.create({ tenantId: tenant._id, userId: user._id, kind, by, promo, messageIdx: m.idx, orderId, couponCode, title: m.title, body: m.body, createdAt: now });
    } catch (e) { if (e.code === 11000) return null; throw e; }   // another run already did this one
    await center.notify('shop_nudge', {
        tenantId: tenant._id, userId: user._id, title: m.title, body: m.body, noEmail: true,
        data: { kind: 'nudge', nudge: kind, ...(couponCode ? { couponCode } : {}) },
    });
    return m;
}

/* --------------------------------- one-tap Remind --------------------------------- */
async function loadForRemind(tenant, userId) {
    const user = mongoose.isValidObjectId(userId) ? await User.findOne({ _id: userId, tenantId: tenant._id, role: 'customer' }).select('name phone isBlocked prefs').lean() : null;
    if (!user) throw httpError(404, 'Customer not found');
    const profiles = await insights.build({ tenantId: tenant._id });
    return { user, profile: profiles.get(String(user._id)) || null, cfg: await getConfig(tenant._id) };
}

// the message the owner will see before sending, and whether it can go now
async function previewRemind({ tenant, userId, withOffer = false, now = new Date() }) {
    const { user, profile, cfg } = await loadForRemind(tenant, userId);
    const offer = withOffer && cfg.maxDiscount > 0;
    const kind = offer ? 'winback_2' : 'manual';
    const m = msgs.build({
        kind, lang: cfg.language, avoid: await recentIdx(tenant._id, user._id, 'manual'), custom: cfg.custom?.[kind],
        vars: { name: user.name, shop: tenant.name, food: profile?.favourites?.[0]?.name || '', discount: cfg.maxDiscount, code: offer ? 'YOURCODE' : '' },
    });
    const hold = await holdBack({ tenantId: tenant._id, user, profile, cfg, now, who: 'owner' });
    return { title: m.title, body: m.body, language: cfg.language, offer, discount: offer ? cfg.maxDiscount : 0, maxDiscount: cfg.maxDiscount, canSend: !hold, holdBack: hold };
}

async function remind({ tenant, userId, title, body, withOffer = false, now = new Date() }) {
    const { user, profile, cfg } = await loadForRemind(tenant, userId);
    const hold = await holdBack({ tenantId: tenant._id, user, profile, cfg, now, who: 'owner' });
    if (hold) throw httpError(409, hold);
    const hasText = title !== undefined || body !== undefined;
    if (hasText) {
        if (typeof title !== 'string' || !title.trim() || title.length > 60) throw httpError(400, 'The title is needed and can be up to 60 letters');
        if (typeof body !== 'string' || !body.trim() || body.length > 200) throw httpError(400, 'The message is needed and can be up to 200 letters');
    }
    const offer = withOffer && cfg.maxDiscount > 0;
    const code = offer ? await makeCoupon(tenant._id, cfg.maxDiscount, now) : null;
    const m = await deliver({
        tenant, user, profile, cfg, kind: 'manual', libKind: offer ? 'winback_2' : 'manual', by: 'owner', couponCode: code, now,
        override: hasText ? { title: title.trim(), body: code && !body.includes(code) ? `${body.trim()} Code: ${code}`.slice(0, 300) : body.trim() } : undefined,
    });
    if (!m) throw httpError(409, 'That message was just sent.');
    return { ok: true, title: m.title, body: m.body, couponCode: code };
}

/* ---------------------------------- the automations ---------------------------------- */
const setup = async (tenant, cfg, now) => {
    const profiles = await insights.build({ tenantId: tenant._id, now });
    const ids = [...profiles.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const users = new Map((await User.find({ _id: { $in: ids }, tenantId: tenant._id, role: 'customer' }).select('name phone isBlocked prefs').lean()).map((u) => [String(u._id), u]));
    return { profiles, users };
};

async function runWelcomeAndThanks(tenant, cfg, ctx, now) {
    let sent = 0;
    if (!cfg.on.welcome && !cfg.on.thanks) return sent;
    if (inQuiet(istHour(now), cfg.quietFrom, cfg.quietTo)) return sent;
    const orders = await Order.find({ tenantId: tenant._id, status: 'delivered', deliveredAt: { $gte: new Date(now.getTime() - DAY), $lte: new Date(now.getTime() - 20 * 60000) } }).select('userId').sort({ deliveredAt: 1 }).lean();
    for (const o of orders) {
        const user = ctx.users.get(String(o.userId));
        const profile = ctx.profiles.get(String(o.userId));
        if (!user || !profile || user.isBlocked) continue;
        const first = profile.orders === 1;
        if (first && cfg.on.welcome) {
            if (await deliver({ tenant, user, profile, cfg, kind: 'welcome', by: 'autopilot', promo: false, orderId: o._id, now })) sent += 1;
        } else if (!first && cfg.on.thanks) {
            const recent = await NudgeLog.exists({ tenantId: tenant._id, userId: user._id, kind: 'thanks', createdAt: { $gte: new Date(now.getTime() - 3 * DAY) } });
            if (recent) continue;
            if (await deliver({ tenant, user, profile, cfg, kind: 'thanks', by: 'autopilot', promo: false, orderId: o._id, now })) sent += 1;
        }
    }
    return sent;
}

// the hour to nudge a customer: the hour before he usually orders, but never inside the quiet hours
function nudgeHour(profile, cfg) {
    if (profile.usualHour === null || profile.usualHour === undefined) return cfg.quietTo;
    let h = (profile.usualHour + 23) % 24;
    if (inQuiet(h, cfg.quietFrom, cfg.quietTo)) h = cfg.quietTo;
    return h;
}

async function runWinback(tenant, cfg, ctx, now) {
    let sent = 0;
    if (!cfg.on.winback) return sent;
    const gaps = WINBACK_GAPS[cfg.frequency];
    const hour = istHour(now);
    const candidates = [...ctx.profiles.values()].filter((p) => (p.tag === 'slipping' || p.tag === 'lost') && p.daysSince <= 120 && nudgeHour(p, cfg) === hour);
    for (const p of candidates) {
        const user = ctx.users.get(p.userId);
        if (!user) continue;
        const logs = await NudgeLog.find({ tenantId: tenant._id, userId: user._id, kind: /^winback_/, createdAt: { $gt: p.lastOrderAt } }).sort({ createdAt: 1 }).select('kind createdAt').lean();
        let step = 1;
        if (logs.length) {
            const last = logs[logs.length - 1];
            const ago = (now.getTime() - new Date(last.createdAt).getTime()) / DAY;
            if (last.kind === 'winback_3') { if (ago < REST_DAYS) continue; step = 1; }   // resting; after the rest a new round may begin
            else { step = Number(last.kind.slice(-1)) + 1; if (ago < gaps[step - 1]) continue; }
        }
        if (await holdBack({ tenantId: tenant._id, user, profile: p, cfg, now, who: 'autopilot' })) continue;
        const offer = step === 2 && cfg.maxDiscount > 0;
        const code = offer ? await makeCoupon(tenant._id, cfg.maxDiscount, now) : null;
        const libKind = step === 2 ? (offer && code ? 'winback_2' : 'winback_1') : `winback_${step}`;
        if (await deliver({ tenant, user, profile: p, cfg, kind: `winback_${step}`, libKind, by: 'autopilot', couponCode: code, now })) sent += 1;
    }
    return sent;
}

async function runMealtime(tenant, cfg, ctx, now) {
    let sent = 0;
    if (!cfg.on.mealtime) return sent;
    const hour = istHour(now);
    const candidates = [...ctx.profiles.values()].filter((p) => ['regular', 'loyal', 'vip'].includes(p.tag) && p.orders >= 3 && p.usualHour !== null && (p.usualHour + 23) % 24 === hour);
    for (const p of candidates) {
        const user = ctx.users.get(p.userId);
        if (!user) continue;
        if (await holdBack({ tenantId: tenant._id, user, profile: p, cfg, now, who: 'autopilot' })) continue;
        const slot = insights.slotOf(p.usualHour);
        const food = p.favouriteBySlot?.[slot] || p.favourites?.[0]?.name;
        if (await deliver({ tenant, user, profile: p, cfg, kind: 'mealtime', libKind: `mealtime_${slot}`, by: 'autopilot', food, now })) sent += 1;
    }
    return sent;
}

async function runFestival(tenant, cfg, ctx, now) {
    let sent = 0;
    if (!cfg.on.festival || istHour(now) !== 11) return sent;
    const day = istDate(now);
    const fest = FESTIVALS.find((f) => f.date === day || f.date === day.slice(5));
    if (!fest) return sent;
    for (const p of ctx.profiles.values()) {
        if (p.daysSince > 90) continue;
        const user = ctx.users.get(p.userId);
        if (!user) continue;
        if (await NudgeLog.exists({ tenantId: tenant._id, userId: user._id, kind: 'festival', createdAt: { $gte: new Date(now.getTime() - 20 * DAY) } })) continue;
        if (await holdBack({ tenantId: tenant._id, user, profile: p, cfg, now, who: 'autopilot' })) continue;
        if (await deliver({ tenant, user, profile: p, cfg, kind: 'festival', by: 'autopilot', extraVars: { festival: fest.name }, now })) sent += 1;
    }
    return sent;
}

async function ownerNote(tenant, type, now, make) {
    const done = await Notification.exists({ tenantId: tenant._id, role: 'owner', type, createdAt: { $gte: istDayStart(now) } });
    if (done) return 0;
    const m = await make();
    if (!m) return 0;
    await center.notify(type, { tenantId: tenant._id, title: m.title, body: m.body, data: m.data, noEmail: true });
    return 1;
}

async function runOwnerNotes(tenant, cfg, now) {
    let sent = 0;
    const hour = istHour(now);
    if (cfg.on.dailySummary && hour === cfg.summaryHour) {
        sent += await ownerNote(tenant, 'owner_daily_summary', now, async () => {
            const r = await closingReport.build({ tenantId: tenant._id, now });
            if (!r.orders.placed) return null;
            const best = r.topItems[0];
            return {
                title: `Today: ${money(r.sales.revenue)} from ${r.sales.orders} order${r.sales.orders === 1 ? '' : 's'}`,
                body: `${r.orders.cancelled ? `${r.orders.cancelled} cancelled. ` : ''}${best ? `Best seller: ${best.name} (${best.quantity}). ` : ''}Tap for the full day.`.trim(),
                data: { kind: 'closing_report' },
            };
        });
    }
    if (cfg.on.weeklyDigest && hour === 9 && new Date(now.getTime() + IST).getUTCDay() === 1) {
        sent += await ownerNote(tenant, 'owner_weekly_digest', now, async () => {
            const r = await businessReport.build({ tenantId: tenant._id, range: '7', now });
            if (!r.totals.orders) return null;
            const c = r.change.revenue;
            return {
                title: `Last week: ${money(r.totals.revenue)} from ${r.totals.orders} orders`,
                body: `${c === null || c === undefined ? '' : `${c >= 0 ? 'Up' : 'Down'} ${Math.abs(c)}% on the week before. `}${r.customers.unique} customers, ${r.customers.repeatPct}% came back. Tap to see more.`,
                data: { kind: 'business_report' },
            };
        });
    }
    return sent;
}

async function runForTenant(tenant, cfg, now = new Date()) {
    if (cfg.platformPaused || tenant.ownerBlocked || tenant.status === 'suspended') return { customers: 0, owner: 0 };
    const owner = await runOwnerNotes(tenant, cfg, now);
    if (!cfg.on.welcome && !cfg.on.thanks && !cfg.on.winback && !cfg.on.mealtime && !cfg.on.festival) return { customers: 0, owner };
    const ctx = await setup(tenant, cfg, now);
    let customers = 0;
    for (const run of [runWelcomeAndThanks, runWinback, runMealtime, runFestival]) {
        try { customers += await run(tenant, cfg, ctx, now); } catch (e) { console.error(`Autopilot (${tenant.name}) error:`, e.message); }
    }
    return { customers, owner };
}

async function runAll(now = new Date()) {
    const platform = await PlatformSettings.findById('main').select('insights').lean();
    if (platform?.insights?.autopilotEnabled === false) return { shops: 0, customers: 0, owner: 0, off: true };
    const rows = await Autopilot.find({ platformPaused: { $ne: true }, $or: AUTOMATIONS.map((k) => ({ [`on.${k}`]: true })) }).lean();
    let customers = 0; let owner = 0;
    for (const row of rows) {
        const tenant = await Tenant.findById(row.tenantId).select('name status ownerBlocked').lean();
        if (!tenant) continue;
        try {
            const r = await runForTenant(tenant, view(row), now);
            customers += r.customers; owner += r.owner;
        } catch (e) { console.error(`Autopilot (${tenant.name}) error:`, e.message); }
    }
    return { shops: rows.length, customers, owner };
}

/* ------------------------------- what it brought back ------------------------------- */
// A customer who orders within 3 days of a message counts as "brought back" by that message (the latest one before his order).
async function stats({ tenantId, days = 30, now = new Date() }) {
    const since = new Date(now.getTime() - days * DAY);
    const logs = await NudgeLog.find({ tenantId, promo: true, createdAt: { $gte: since } }).sort({ createdAt: 1 }).select('userId kind by createdAt title').lean();
    const users = [...new Set(logs.map((l) => String(l.userId)))].map((id) => new mongoose.Types.ObjectId(id));
    const orders = users.length ? await Order.find({ tenantId, userId: { $in: users }, status: 'delivered', createdAt: { $gte: since } }).select('userId createdAt pricing.total').sort({ createdAt: 1 }).lean() : [];

    const byKind = {};
    const bump = (k) => { byKind[k] = byKind[k] || { sent: 0, orders: 0, revenue: 0, customers: new Set() }; return byKind[k]; };
    const perUser = new Map();
    logs.forEach((l) => { bump(l.kind.replace(/_\d$/, '')).sent += 1; const k = String(l.userId); if (!perUser.has(k)) perUser.set(k, []); perUser.get(k).push(l); });
    const back = new Set(); let revenue = 0; let count = 0;
    for (const o of orders) {
        const list = perUser.get(String(o.userId)) || [];
        const t = new Date(o.createdAt).getTime();
        const cause = [...list].reverse().find((l) => new Date(l.createdAt).getTime() < t && t - new Date(l.createdAt).getTime() <= 3 * DAY);
        if (!cause) continue;
        const b = bump(cause.kind.replace(/_\d$/, ''));
        b.orders += 1; b.revenue += o.pricing?.total || 0; b.customers.add(String(o.userId));
        back.add(String(o.userId)); revenue += o.pricing?.total || 0; count += 1;
    }
    const recent = (await NudgeLog.find({ tenantId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(20).select('kind by title createdAt userId').lean());
    const names = new Map((await User.find({ _id: { $in: recent.map((r) => r.userId) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
    return {
        days, sent: logs.length, broughtBack: back.size, orders: count, revenue: Math.round(revenue),
        byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { sent: v.sent, orders: v.orders, revenue: Math.round(v.revenue), customers: v.customers.size }])),
        recent: recent.map((r) => ({ kind: r.kind, by: r.by, title: r.title, at: r.createdAt, customer: names.get(String(r.userId)) || '' })),
    };
}

module.exports = {
    AUTOMATIONS, RECOMMENDED, WEEKLY_CAP, FESTIVALS, getConfig, saveConfig, previewRemind, remind, runForTenant, runAll, stats, holdBack, inQuiet,
};
