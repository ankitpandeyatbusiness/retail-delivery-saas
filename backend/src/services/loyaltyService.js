// Points: for customers (spend them for money off) and for riders (they decide the badge everybody sees).
//
// CUSTOMER  points = money spent on food / ₹10 × pointsPerTen. They arrive holdHours (24) after the order is delivered, so a refund or a
//           complaint in that time takes them back before they were ever spent. While waiting they are shown as "on the way, arrive at hh:mm".
//           1 rupee off = pointsPerRupee points (10 → 100 points = ₹10). At most maxPercent of the food bill can be paid with points, and at
//           least minRedeem points are needed. Spending is ONE atomic update on LoyaltyAccount, so the same points can never be spent twice.
// RIDER     every delivery, rating, fault... is a line in the book. His badge comes from the points of the last 30 days and his rating.
//           The shop never pays money through the app: the points, badge and the Top riders list are for recognition and for the owner's own
//           reward outside the app.
// The shop's own numbers are in tenant.settings.loyalty; anything missing falls back to RECOMMENDED below ("Reset to recommended").
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const LoyaltyAccount = require('../models/LoyaltyAccount');
const LoyaltyEntry = require('../models/LoyaltyEntry');

const DAY = 86400000;
const BADGES = ['bronze', 'silver', 'gold', 'platinum'];

const RECOMMENDED = {
    customer: {
        enabled: true,
        pointsPerTen: 1,          // points for every ₹10 of food
        firstOrderBonus: 20,
        foodReviewBonus: 5,
        deliveryReviewBonus: 3,
        holdHours: 24,            // points arrive this long after the delivery
        pointsPerRupee: 10,       // 10 points = ₹1 off (100 points = ₹10)
        maxPercent: 20,           // at most this much of the food bill can be paid with points
        minRedeem: 100,
        expiryMonths: 12,
        // levels by what he spent on food in the last 12 months; each gives extra points on every order
        levels: { silver: { spend: 5000, bonusPct: 10 }, gold: { spend: 15000, bonusPct: 25 }, platinum: { spend: 40000, bonusPct: 50 } },
    },
    rider: {
        enabled: true,
        perDelivery: 10,
        onTime: 3,
        stars: { 5: 10, 4: 5, 3: 0, 2: -5, 1: -10 },
        fault: -15,               // a complaint decided as his fault
        cancelAfterPickup: -10,
        minRated: 10,             // rated deliveries needed before he can be above bronze
        silver: { points: 150, rating: 4.0 },
        gold: { points: 400, rating: 4.4 },
        platinum: { points: 800, rating: 4.7 },   // and no fault in the last 30 days
    },
};

/* ------------------------------ the shop's numbers ------------------------------ */
const merge = (base, over) => {
    const out = {};
    for (const k of Object.keys(base)) {
        out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], over && over[k]) : (over && over[k] !== undefined ? over[k] : base[k]);
    }
    return out;
};
const settingsOf = (tenant) => merge(RECOMMENDED, tenant?.settings?.loyalty);

const fail = (m) => Object.assign(new Error(m), { status: 400 });
const num = (v, name, min, max, whole = true) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) throw fail(`${name} must be ${whole ? 'a whole number ' : ''}from ${min} to ${max}`);
    return n;
};

// the owner's choices, checked. Returns the whole object to save (merged over the recommended values).
function clean(body, current) {
    const b = body || {};
    const base = merge(RECOMMENDED, current);
    const c = { ...base.customer, ...(b.customer || {}), levels: { ...base.customer.levels, ...(((b.customer || {}).levels) || {}) } };
    for (const k of ['silver', 'gold', 'platinum']) c.levels[k] = { ...base.customer.levels[k], ...((((b.customer || {}).levels) || {})[k] || {}) };
    const r = { ...base.rider, ...(b.rider || {}), stars: { ...base.rider.stars, ...((b.rider || {}).stars || {}) } };
    for (const k of ['silver', 'gold', 'platinum']) r[k] = { ...base.rider[k], ...(((b.rider || {})[k]) || {}) };
    const out = {
        customer: {
            enabled: c.enabled !== false,
            pointsPerTen: num(c.pointsPerTen, 'Points per ₹10', 0, 20),
            firstOrderBonus: num(c.firstOrderBonus, 'First order bonus', 0, 500),
            foodReviewBonus: num(c.foodReviewBonus, 'Food review bonus', 0, 100),
            deliveryReviewBonus: num(c.deliveryReviewBonus, 'Delivery review bonus', 0, 100),
            holdHours: num(c.holdHours, 'Waiting time', 0, 168),
            pointsPerRupee: num(c.pointsPerRupee, 'Points for ₹1 off', 1, 1000),
            maxPercent: num(c.maxPercent, 'Most of the bill', 1, 100),
            minRedeem: num(c.minRedeem, 'Least points to use', 0, 100000),
            expiryMonths: num(c.expiryMonths, 'Points last (months)', 1, 60),
            levels: Object.fromEntries(['silver', 'gold', 'platinum'].map((k) => [k, {
                spend: num(((c.levels || {})[k] || {}).spend, `${k} spend`, 1, 100000000),
                bonusPct: num(((c.levels || {})[k] || {}).bonusPct, `${k} extra points`, 0, 500),
            }])),
        },
        rider: {
            enabled: r.enabled !== false,
            perDelivery: num(r.perDelivery, 'Points per delivery', 0, 100),
            onTime: num(r.onTime, 'On-time bonus', 0, 100),
            stars: Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, num(r.stars[s], `${s} star points`, -100, 100)])),
            fault: num(r.fault, 'Fault points', -200, 0),
            cancelAfterPickup: num(r.cancelAfterPickup, 'Cancel after pickup points', -200, 0),
            minRated: num(r.minRated, 'Rated deliveries needed', 0, 500),
            silver: { points: num(r.silver.points, 'Silver points', 1, 100000), rating: num(r.silver.rating, 'Silver rating', 1, 5, false) },
            gold: { points: num(r.gold.points, 'Gold points', 1, 100000), rating: num(r.gold.rating, 'Gold rating', 1, 5, false) },
            platinum: { points: num(r.platinum.points, 'Platinum points', 1, 100000), rating: num(r.platinum.rating, 'Platinum rating', 1, 5, false) },
        },
    };
    const lv = out.customer.levels;
    if (!(lv.silver.spend < lv.gold.spend && lv.gold.spend < lv.platinum.spend)) throw fail('Level spends must grow: Silver, then Gold, then Platinum');
    if (!(out.rider.silver.points < out.rider.gold.points && out.rider.gold.points < out.rider.platinum.points)) throw fail('Badge points must grow: Silver, then Gold, then Platinum');
    return out;
}

/* ------------------------------ the book ------------------------------ */
// A line is written once: the same event repeated (retry, double tap) hits the unique index and does nothing.
async function writeOnce(doc) {
    try { return await LoyaltyEntry.create(doc); } catch (e) { if (e.code === 11000) return null; throw e; }
}
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

/* ------------------------------ customer: levels ------------------------------ */
// what he spent on food (after discounts) on delivered orders in the last 12 months
async function yearSpend(tenantId, userId) {
    const [r] = await Order.aggregate([
        { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), userId: new mongoose.Types.ObjectId(String(userId)), status: 'delivered', deliveredAt: { $gte: new Date(Date.now() - 365 * DAY) } } },
        { $group: { _id: null, t: { $sum: { $subtract: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.discount', 0] }] } } } },
    ]);
    return Math.max(0, Math.round(r?.t || 0));
}
const LEVELS = ['member', 'silver', 'gold', 'platinum'];
function levelOf(spend, cfg) {
    let name = 'member';
    for (const k of ['silver', 'gold', 'platinum']) if (spend >= cfg.levels[k].spend) name = k;
    const i = LEVELS.indexOf(name);
    const nextName = LEVELS[i + 1];
    return {
        name, bonusPct: name === 'member' ? 0 : cfg.levels[name].bonusPct, spend,
        next: nextName ? { name: nextName, spendNeeded: Math.max(0, cfg.levels[nextName].spend - spend), bonusPct: cfg.levels[nextName].bonusPct } : null,
    };
}

/* ------------------------------ customer: earning ------------------------------ */
// the food money of an order that the customer really paid: subtotal minus every discount
const foodMoney = (o) => Math.max(0, Number(o.pricing?.subtotal || 0) - Number(o.pricing?.discount || 0));

async function earnPending({ tenantId, userId, orderId, orderNo, reason, points, cfg, note, from = new Date() }) {
    if (!(points > 0)) return null;
    const availableAt = new Date(from.getTime() + cfg.holdHours * 3600000);
    const e = await writeOnce({
        tenantId, userId, kind: 'customer', reason, points, status: 'pending', availableAt, orderId, orderNo,
        expiresAt: new Date(availableAt.getTime() + cfg.expiryMonths * 30 * DAY), note,
    });
    return e;
}

// the order was delivered: the customer's points start waiting, the rider's points are written
async function onDelivered(order) {
    const tenant = await Tenant.findById(order.tenantId).select('settings.loyalty').lean();
    const cfg = settingsOf(tenant);
    if (cfg.customer.enabled && order.userId) {
        const base = foodMoney(order);
        const lvl = levelOf(await yearSpend(order.tenantId, order.userId), cfg.customer);   // his level, with this order counted
        const pts = Math.floor((base / 10) * cfg.customer.pointsPerTen * (1 + lvl.bonusPct / 100));
        const from = order.deliveredAt || new Date();
        await earnPending({ tenantId: order.tenantId, userId: order.userId, orderId: order._id, orderNo: order.orderNo, reason: 'order', points: pts, cfg: cfg.customer, from, note: lvl.bonusPct ? `Order delivered · ${lvl.name} level +${lvl.bonusPct}%` : 'Order delivered' });
        if (cfg.customer.firstOrderBonus > 0) {
            const delivered = await Order.countDocuments({ tenantId: order.tenantId, userId: order.userId, status: 'delivered' });
            if (delivered === 1) await earnPending({ tenantId: order.tenantId, userId: order.userId, orderId: order._id, orderNo: order.orderNo, reason: 'first', points: cfg.customer.firstOrderBonus, cfg: cfg.customer, from, note: 'First order bonus' });
        }
    }
    const riderId = order.delivery?.riderId;
    if (cfg.rider.enabled && riderId) {
        const late = order.delivery?.dueAt && order.delivery?.deliveredAt && new Date(order.delivery.deliveredAt) > new Date(order.delivery.dueAt);
        const onTime = order.delivery?.dueAt && !late;
        await riderAdd({ tenantId: order.tenantId, userId: riderId, orderId: order._id, orderNo: order.orderNo, reason: 'delivered', points: cfg.rider.perDelivery + (onTime ? cfg.rider.onTime : 0), note: onTime ? 'Delivered on time' : 'Delivered', cfg });
    }
}

// the customer rated the food (+ bonus) or the delivery (+ bonus for him, stars for the rider)
async function onFoodRated(order) {
    const tenant = await Tenant.findById(order.tenantId).select('settings.loyalty').lean();
    const cfg = settingsOf(tenant);
    if (!cfg.customer.enabled) return;
    await earnPending({ tenantId: order.tenantId, userId: order.userId, orderId: order._id, orderNo: order.orderNo, reason: 'review_food', points: cfg.customer.foodReviewBonus, cfg: cfg.customer, note: 'Food review' });
}
async function onDeliveryRated(order, rating) {
    const tenant = await Tenant.findById(order.tenantId).select('settings.loyalty').lean();
    const cfg = settingsOf(tenant);
    if (cfg.customer.enabled) await earnPending({ tenantId: order.tenantId, userId: order.userId, orderId: order._id, orderNo: order.orderNo, reason: 'review_delivery', points: cfg.customer.deliveryReviewBonus, cfg: cfg.customer, note: 'Delivery review' });
    const riderId = order.delivery?.riderId;
    if (cfg.rider.enabled && riderId) {
        await riderAdd({ tenantId: order.tenantId, userId: riderId, orderId: order._id, orderNo: order.orderNo, reason: 'stars', points: cfg.rider.stars[rating] || 0, note: `${rating} star${rating === 1 ? '' : 's'} from the customer`, cfg, stars: rating });
    }
}

// money was given back for an order whose points are still waiting: they never arrive
async function voidPendingForOrder(tenantId, orderId) {
    try { await LoyaltyEntry.updateMany({ tenantId, orderId, kind: 'customer', status: 'pending' }, { $set: { status: 'void', note: 'Refunded before the points arrived' } }); } catch (e) { /* the job still checks */ }
}

// every 5 minutes: points whose waiting time is over become spendable; points that lasted their months expire
async function releaseDue(now = new Date()) {
    const due = await LoyaltyEntry.find({ kind: 'customer', status: 'pending', availableAt: { $lte: now } }).limit(300).lean();
    const told = new Map();
    for (const e of due) {
        const claimed = await LoyaltyEntry.findOneAndUpdate({ _id: e._id, status: 'pending' }, { $set: { status: 'done' } });
        if (!claimed) continue;
        await LoyaltyAccount.updateOne({ tenantId: e.tenantId, userId: e.userId }, { $inc: { balance: e.points, lifetime: e.points } }, { upsert: true });
        const k = `${e.tenantId}:${e.userId}`;
        told.set(k, { tenantId: e.tenantId, userId: e.userId, points: (told.get(k)?.points || 0) + e.points });
    }
    for (const t of told.values()) {
        const acc = await LoyaltyAccount.findOne({ tenantId: t.tenantId, userId: t.userId }).select('balance').lean();
        tell('points_arrived', { tenantId: t.tenantId, userId: t.userId, vars: { points: t.points, balance: acc?.balance || t.points }, data: { kind: 'points' } });
    }
    const old = await LoyaltyEntry.find({ kind: 'customer', status: 'done', points: { $gt: 0 }, expired: false, expiresAt: { $lte: now } }).limit(200).lean();
    for (const e of old) {
        const claimed = await LoyaltyEntry.findOneAndUpdate({ _id: e._id, expired: false }, { $set: { expired: true } });
        if (!claimed) continue;
        const acc = await LoyaltyAccount.findOne({ tenantId: e.tenantId, userId: e.userId }).select('balance').lean();
        const take = Math.min(e.points, acc?.balance || 0);
        if (take > 0) {
            await LoyaltyAccount.updateOne({ tenantId: e.tenantId, userId: e.userId, balance: { $gte: take } }, { $inc: { balance: -take } });
            await LoyaltyEntry.create({ tenantId: e.tenantId, userId: e.userId, kind: 'customer', reason: 'expire', points: -take, status: 'done', note: 'Points expired' });
        }
    }
    return { released: due.length, expired: old.length };
}

/* ------------------------------ customer: spending ------------------------------ */
// What the cart shows: the balance, what is on the way, and how many points can pay for this bill.
async function cartInfo({ tenant, userId, subtotal, couponDiscount = 0 }) {
    const cfg = settingsOf(tenant).customer;
    if (!cfg.enabled || !userId) return { enabled: false };
    const [acc, pend] = await Promise.all([
        LoyaltyAccount.findOne({ tenantId: tenant._id, userId }).select('balance').lean(),
        pendingOf(tenant._id, userId),
    ]);
    const balance = acc?.balance || 0;
    const room = Math.max(0, Math.floor((Math.max(0, subtotal - couponDiscount) * cfg.maxPercent) / 100));   // whole rupees
    const maxPoints = Math.min(balance - (balance % cfg.pointsPerRupee), room * cfg.pointsPerRupee);
    const canUse = balance >= cfg.minRedeem && maxPoints >= cfg.pointsPerRupee;
    return {
        enabled: true, balance, pendingPoints: pend.points, pendingAt: pend.nextAt,
        canUse, minRedeem: cfg.minRedeem, pointsPerRupee: cfg.pointsPerRupee, maxPercent: cfg.maxPercent,
        maxPoints: canUse ? maxPoints : 0, maxRupees: canUse ? maxPoints / cfg.pointsPerRupee : 0,
    };
}

// the bill with the customer's choice "use my points": { points, rupees } or null
async function priceWithPoints({ tenant, userId, subtotal, couponDiscount }) {
    const info = await cartInfo({ tenant, userId, subtotal, couponDiscount });
    if (!info.enabled || !info.canUse) return null;
    return { points: info.maxPoints, rupees: info.maxPoints / info.pointsPerRupee };
}

// the order is being placed: take the points (one atomic update). Throws when they are no longer there.
async function debit({ tenantId, userId, points, orderId, orderNo }) {
    const acc = await LoyaltyAccount.findOneAndUpdate({ tenantId, userId, balance: { $gte: points } }, { $inc: { balance: -points } });
    if (!acc) throw Object.assign(new Error('Your points changed. Please check your cart.'), { status: 409 });
    await writeOnce({ tenantId, userId, kind: 'customer', reason: 'redeem', points: -points, status: 'done', orderId, orderNo, note: 'Used on an order' });
}
// the order did not happen (or was cancelled): the points go back, once
async function giveBack({ tenantId, userId, orderId }) {
    const used = await LoyaltyEntry.findOne({ tenantId, userId, kind: 'customer', reason: 'redeem', orderId, status: 'done' }).lean();
    if (!used) return;
    const back = await writeOnce({ tenantId, userId, kind: 'customer', reason: 'return', points: -used.points, status: 'done', orderId, orderNo: used.orderNo, note: 'Order cancelled: points returned' });
    if (back) await LoyaltyAccount.updateOne({ tenantId, userId }, { $inc: { balance: -used.points } }, { upsert: true });
}
const returnForOrder = (order) => (order.pricing?.pointsUsed > 0 ? giveBack({ tenantId: order.tenantId, userId: order.userId, orderId: order._id }) : null);

// points on the way: how many and when the next ones arrive
async function pendingOf(tenantId, userId) {
    const rows = await LoyaltyEntry.find({ tenantId, userId, kind: 'customer', status: 'pending' }).sort({ availableAt: 1 }).select('points availableAt orderNo').lean();
    return { points: rows.reduce((n, r) => n + r.points, 0), nextAt: rows[0]?.availableAt || null, rows };
}

// the customer's page
async function customerView(tenant, userId) {
    const cfg = settingsOf(tenant).customer;
    if (!cfg.enabled) return { enabled: false };
    const [acc, pend, history, spend] = await Promise.all([
        LoyaltyAccount.findOne({ tenantId: tenant._id, userId }).select('balance lifetime').lean(),
        pendingOf(tenant._id, userId),
        LoyaltyEntry.find({ tenantId: tenant._id, userId, kind: 'customer', status: { $in: ['done', 'pending'] } }).sort({ createdAt: -1 }).limit(40).select('reason points status availableAt orderNo note createdAt').lean(),
        yearSpend(tenant._id, userId),
    ]);
    return {
        enabled: true, balance: acc?.balance || 0, lifetime: acc?.lifetime || 0,
        level: levelOf(spend, cfg),
        pending: { points: pend.points, nextAt: pend.nextAt, items: pend.rows.map((r) => ({ points: r.points, at: r.availableAt, orderNo: r.orderNo || null })) },
        rules: {
            perTen: cfg.pointsPerTen, firstOrder: cfg.firstOrderBonus, foodReview: cfg.foodReviewBonus, deliveryReview: cfg.deliveryReviewBonus,
            holdHours: cfg.holdHours, pointsPerRupee: cfg.pointsPerRupee, maxPercent: cfg.maxPercent, minRedeem: cfg.minRedeem, expiryMonths: cfg.expiryMonths,
            levels: cfg.levels,
        },
        history: history.map((h) => ({ reason: h.reason, points: h.points, pending: h.status === 'pending', at: h.status === 'pending' ? h.availableAt : h.createdAt, orderNo: h.orderNo || null, note: h.note || '' })),
    };
}

/* ------------------------------ rider ------------------------------ */
async function riderAdd({ tenantId, userId, orderId, orderNo, reason, points, note, cfg, stars }) {
    try {
        if (!points && !stars) return;
        const c = cfg || settingsOf(await Tenant.findById(tenantId).select('settings.loyalty').lean());
        if (!c.rider.enabled) return;
        await writeOnce({ tenantId, userId, kind: 'rider', reason, points, status: 'done', orderId, orderNo, note, ...(stars ? { stars } : {}) });
        await refreshRider(tenantId, userId, c);
    } catch (e) {
        console.error('Rider points error:', e.message);
    }
}

function badgeOf(points, rating, rated, faults, r) {
    if (rated < r.minRated) return 'bronze';
    if (points >= r.platinum.points && rating >= r.platinum.rating && faults === 0) return 'platinum';
    if (points >= r.gold.points && rating >= r.gold.rating) return 'gold';
    if (points >= r.silver.points && rating >= r.silver.rating) return 'silver';
    return 'bronze';
}
function nextBadge(badge, points, r) {
    const i = BADGES.indexOf(badge);
    if (i >= BADGES.length - 1) return null;
    const name = BADGES[i + 1];
    return { badge: name, pointsNeeded: Math.max(0, r[name].points - points), rating: r[name].rating };
}

// recalculates and saves a rider's standing from the last 30 days
async function refreshRider(tenantId, userId, cfg) {
    const c = cfg || settingsOf(await Tenant.findById(tenantId).select('settings.loyalty').lean());
    const since = new Date(Date.now() - 30 * DAY);
    const [rows, rider] = await Promise.all([
        LoyaltyEntry.aggregate([
            { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), userId: new mongoose.Types.ObjectId(String(userId)), kind: 'rider', status: 'done', createdAt: { $gte: since } } },
            { $group: { _id: '$reason', pts: { $sum: '$points' }, n: { $sum: 1 } } },
        ]),
        Rider.findOne({ tenantId, userId }).select('ratingAvg ratingCount loyalty').lean(),
    ]);
    const points30 = Math.max(0, rows.reduce((n, r) => n + r.pts, 0));
    const faults30 = rows.find((r) => r._id === 'fault')?.n || 0;
    const badge = badgeOf(points30, rider?.ratingAvg || 0, rider?.ratingCount || 0, faults30, c.rider);
    await Rider.updateOne({ tenantId, userId }, { $set: { loyalty: { points30, badge, faults30, at: new Date() } } });
    if (rider?.loyalty?.badge && rider.loyalty.badge !== badge && BADGES.indexOf(badge) > BADGES.indexOf(rider.loyalty.badge)) {
        tell('rider_badge', { tenantId, userId, vars: { badge }, data: { kind: 'badge' } });   // he moved up
    }
    return { points30, badge, faults30 };
}

// riders whose saved standing is missing or more than 6 hours old are recalculated (the 30 days keep moving)
async function freshen(tenantId, riders) {
    const c = settingsOf(await Tenant.findById(tenantId).select('settings.loyalty').lean());
    if (!c.rider.enabled) return;
    for (const r of riders) {
        if (!r.userId) continue;
        const at = r.loyalty?.at ? new Date(r.loyalty.at).getTime() : 0;
        if (Date.now() - at > 6 * 3600000) Object.assign(r, { loyalty: { ...(await refreshRider(tenantId, r.userId, c)), at: new Date() } });
    }
}

// what the apps show about one rider
function standing(tenant, rider) {
    const c = settingsOf(tenant);
    if (!c.rider.enabled) return null;
    const l = rider?.loyalty || {};
    const points = l.points30 || 0;
    const badge = l.badge || 'bronze';
    return {
        badge, points, rating: rider?.ratingAvg || 0, rated: rider?.ratingCount || 0, deliveries: rider?.deliveryCount || 0,
        next: nextBadge(badge, points, c.rider), needRated: Math.max(0, c.rider.minRated - (rider?.ratingCount || 0)),
    };
}

// Ratings customers gave him since he last closed the news: what each gave or took, and where he stands now.
async function riderNews(tenant, userId) {
    const rider = await Rider.findOne({ tenantId: tenant._id, userId }).select('userId ratingAvg ratingCount deliveryCount loyalty newsSeenAt').lean();
    if (!rider) return { items: [] };
    const since = rider.newsSeenAt || new Date(Date.now() - 3 * DAY);
    const rows = await LoyaltyEntry.find({ tenantId: tenant._id, userId, kind: 'rider', reason: 'stars', createdAt: { $gt: since } }).sort({ createdAt: -1 }).limit(5).select('stars points orderNo createdAt').lean();
    if (!rows.length) return { items: [] };
    await freshen(tenant._id, [rider]);
    return { items: rows.map((r) => ({ rating: r.stars || null, points: r.points, orderNo: r.orderNo || null, at: r.createdAt })), standing: standing(tenant, rider) };
}
async function riderNewsSeen(tenantId, userId) {
    await Rider.updateOne({ tenantId, userId }, { $set: { newsSeenAt: new Date() } });
}

async function riderHistory(tenantId, userId, limit = 40) {
    const rows = await LoyaltyEntry.find({ tenantId, userId, kind: 'rider', status: 'done' }).sort({ createdAt: -1 }).limit(limit).select('reason points orderNo note createdAt').lean();
    return rows.map((h) => ({ reason: h.reason, points: h.points, orderNo: h.orderNo || null, note: h.note || '', at: h.createdAt }));
}

// the owner's Top riders list
async function board(tenant) {
    const riders = await Rider.find({ tenantId: tenant._id, isActive: true }).select('userId name photo ratingAvg ratingCount deliveryCount loyalty').lean();
    await freshen(tenant._id, riders);
    return riders
        .map((r) => ({ userId: r.userId, name: r.name || 'Delivery partner', photo: r.photo || null, ...standing(tenant, r) }))
        .filter((r) => r && r.badge)
        .sort((a, b) => b.points - a.points);
}

// a complaint was decided as the rider's fault / he cancelled after collecting the food
async function onRiderFault({ tenantId, userId, orderId, orderNo }) {
    const c = settingsOf(await Tenant.findById(tenantId).select('settings.loyalty').lean());
    return riderAdd({ tenantId, userId, orderId, orderNo, reason: 'fault', points: c.rider.fault, note: 'A complaint was decided as his fault', cfg: c });
}
async function onRiderCancelledAfterPickup(order) {
    const c = settingsOf(await Tenant.findById(order.tenantId).select('settings.loyalty').lean());
    return riderAdd({ tenantId: order.tenantId, userId: order.delivery.riderId, orderId: order._id, orderNo: order.orderNo, reason: 'cancel_pickup', points: c.rider.cancelAfterPickup, note: 'Cancelled after collecting the food', cfg: c });
}

module.exports = {
    riderNews, riderNewsSeen, onRiderFault, onRiderCancelledAfterPickup,
    RECOMMENDED, BADGES, settingsOf, clean,
    onDelivered, onFoodRated, onDeliveryRated, voidPendingForOrder, releaseDue,
    cartInfo, priceWithPoints, debit, giveBack, returnForOrder, pendingOf, customerView,
    riderAdd, refreshRider, freshen, standing, riderHistory, board,
};
