// Plans (Partner / Growth / Pro): platform defaults + switching a shop's plan. Phase 1 = foundation only (no payment, no expiry job yet).
// Only the supreme admin routes call the writers. See config/plans.js for the catalog and docs/plans-and-pricing.md.
const plans = require('../config/plans');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');

const DAY = 86400000;
const IST = 5.5 * 3600000;
// exact end of an India calendar day (23:59:59.999 IST) of the moment `d`, plus `days` days
const endOfIstDay = (d, days = 0) => {
    const t = new Date(d.getTime() + IST + days * DAY);
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 23, 59, 59, 999) - IST);
};

// the platform defaults: the catalog values with whatever the supreme admin changed on top
async function getDefaults() {
    const doc = await PlatformSettings.findById('main').select('plans').lean();
    const saved = doc?.plans || {};
    const d = plans.DEFAULTS;
    return {
        partner: { ...d.partner, ...(saved.partner || {}) },
        growth: { ...d.growth, ...(saved.growth || {}) },
        pro: { ...d.pro, ...(saved.pro || {}) },
        feeSlabs: saved.feeSlabs || d.feeSlabs,
        freeDays: saved.freeDays ?? d.freeDays,
        graceDays: saved.graceDays ?? d.graceDays,
        gstPercent: saved.gstPercent ?? d.gstPercent,
        overdraftPaise: saved.overdraftPaise ?? d.overdraftPaise, minTopupPaise: saved.minTopupPaise ?? d.minTopupPaise, maxTopupPaise: saved.maxTopupPaise ?? d.maxTopupPaise,
        packsPaise: saved.packsPaise || d.packsPaise, walletLowPercent: saved.walletLowPercent ?? d.walletLowPercent,
        includedBranches: saved.includedBranches ?? d.includedBranches,
        branchAddonPaise: saved.branchAddonPaise ?? d.branchAddonPaise,
        monthDiscounts: { ...d.monthDiscounts, ...(saved.monthDiscounts || {}) },
        features: Object.fromEntries(plans.EDITABLE.map((k) => [k, plans.plansOf(k)])),   // what each plan includes now
    };
}

const INT = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Validate + save the platform defaults. Returns the new defaults. Throws Error with .status 400 on bad input.
async function saveDefaults(body) {
    const b = body || {};
    const bad = (m) => Object.assign(new Error(m), { status: 400 });
    const set = {};
    for (const id of ['growth', 'pro']) {
        const v = b[id]?.pricePaise;
        if (v === undefined) continue;
        if (!INT(v, 0, 100000000)) throw bad(`${id}: the price must be a whole number of paise`);
        set[`plans.${id}.pricePaise`] = v;
    }
    if (b.feeSlabs !== undefined) {
        const e = plans.checkFeeSlabs(b.feeSlabs);
        if (e) throw bad(e);
        set['plans.feeSlabs'] = b.feeSlabs.map((s) => ({ upTo: s.upTo, feeRs: s.feeRs }));
    }
    const nums = { freeDays: [0, 365], graceDays: [0, 30], gstPercent: [0, 28], includedBranches: [0, 50], branchAddonPaise: [0, 100000000], overdraftPaise: [0, 1000000], minTopupPaise: [100, 100000000], walletLowPercent: [0, 100] };
    for (const [k, [min, max]] of Object.entries(nums)) {
        if (b[k] === undefined) continue;
        if (!INT(b[k], min, max)) throw bad(`${k} must be a whole number from ${min} to ${max}`);
        set[`plans.${k}`] = b[k];
    }
    if (b.monthDiscounts !== undefined) {
        for (const m of [1, 2, 3, 4, 5, 6]) {
            const v = b.monthDiscounts?.[m];
            if (v === undefined) continue;
            if (!INT(v, 0, 50)) throw bad(`Discount for ${m} month(s) must be a whole percent from 0 to 50`);
            set[`plans.monthDiscounts.${m}`] = v;
        }
    }
    if (b.features !== undefined) {
        if (!b.features || typeof b.features !== 'object') throw bad('Send the features as an object');
        const map = {};
        for (const [k, v] of Object.entries(b.features)) {
            if (!plans.EDITABLE.includes(k)) throw bad(`"${k}" cannot be moved between plans`);
            if (!Array.isArray(v) || v.some((id) => !plans.isPlan(id))) throw bad(`${k}: choose from partner, growth and pro`);
            map[k] = plans.PLAN_IDS.filter((id) => v.includes(id));
        }
        const all = Object.fromEntries(plans.EDITABLE.map((k) => [k, map[k] || plans.plansOf(k)]));
        set['plans.features'] = all;
    }
    if (!Object.keys(set).length) throw bad('Nothing to change');
    await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true, setDefaultsOnInsert: true });
    if (set['plans.features']) plans.setFeatureOverrides(set['plans.features']);   // takes effect at once on this server; the others pick it up within seconds
    return getDefaults();
}

// Everything the apps need about one shop's plan (also used by the Shops tab cards)
function viewOf(tenant, now = new Date()) {
    const p = tenant?.plan || {};
    if (!p.id) return { id: null, status: 'none', extras: [], webEnabled: p.webEnabled !== false, nativeEnabled: p.nativeEnabled !== false };
    const endsAt = p.endsAt ? new Date(p.endsAt) : null;
    const free = p.freeUntil && new Date(p.freeUntil) > now;
    const status = !endsAt && p.id === 'partner' ? 'active' : !endsAt ? 'active' : endsAt < now ? 'ended' : free ? 'free' : 'active';
    return {
        id: p.id, status, startedAt: p.startedAt || null, endsAt, freeUntil: p.freeUntil || null,
        daysLeft: endsAt ? Math.max(0, Math.ceil((endsAt - now) / DAY)) : null,
        extras: (p.extras || []).map((e) => e.key),
        scheduled: p.scheduled ? { to: p.scheduled.to, at: p.scheduled.at } : null,
        paused: !!p.paused, webEnabled: p.webEnabled !== false, nativeEnabled: p.nativeEnabled !== false,
        limits: { riders: plans.limitFor(p.id, 'riders'), staff: plans.limitFor(p.id, 'staff') },
        features: { ...plans.featuresOf(p.id), ...Object.fromEntries((p.extras || []).map((e) => [e.key, true])) },   // the plan plus the extras the supreme admin switched on
    };
}

// Switch a shop's plan (supreme admin, instant). `extras` = feature keys outside the plan to keep (default: keep the old extras only if they still lie outside the new plan).
// freeDays > 0 starts a free period (no invoice). Partner has no end date (wallet based).
async function setPlan(tenantDoc, { to, freeDays, keepExtras = true, by = 'supreme' }) {
    await require('./brandPlan').guardBranch(tenantDoc);   // a branch follows its brand's main shop
    if (!plans.isPlan(to)) throw Object.assign(new Error('Plan must be partner, growth or pro'), { status: 400 });
    const now = new Date();
    const def = await getDefaults();
    const from = tenantDoc.plan?.id || null;
    const days = freeDays !== undefined ? freeDays : (tenantDoc.plan?.freeDaysOverride ?? def.freeDays);
    if (!INT(days, 0, 365)) throw Object.assign(new Error('Free days must be a whole number from 0 to 365'), { status: 400 });
    const p = tenantDoc.plan || {};
    p.id = to;
    p.startedAt = now;
    delete p.paused; delete p.notified; delete p.scheduled;
    if (to === 'partner') { p.endsAt = undefined; p.freeUntil = undefined; }
    else if (days > 0) { p.endsAt = endOfIstDay(now, days - 1); p.freeUntil = p.endsAt; }
    else { p.endsAt = endOfIstDay(now, -1); p.freeUntil = undefined; }   // no free days and nothing paid yet: it ended, the owner is asked to choose/pay (phase 5)
    p.extras = keepExtras ? (p.extras || []).filter((e) => !plans.planIncludes(to, e.key)) : [];
    p.history = [...(p.history || []).slice(-49), { at: now, by, from, to, note: days > 0 && to !== 'partner' ? `free ${days} days` : '' }];
    await Tenant.updateOne({ _id: tenantDoc._id }, { $set: { plan: p } });   // loadTenant hands over a plain object, so write with updateOne
    tenantDoc.plan = p;
    invalidateTenant(tenantDoc.slug);
    await require('./brandPlan').afterPlanChange(tenantDoc);
    if (from !== to) require('./planLifecycle').notifyChanged({ tenantId: tenantDoc._id, from, to, by, admin: true });
    return viewOf(tenantDoc, now);
}

// End the FREE period now: the plan ends at this moment and the grace days start (a paid term is never touched). Supreme admin; a branch follows its main shop.
async function endFree(tenantDoc, by = 'supreme') {
    await require('./brandPlan').guardBranch(tenantDoc);
    const p = tenantDoc.plan || {};
    const now = new Date();
    if (!p.id || !(p.freeUntil && new Date(p.freeUntil) > now)) throw Object.assign(new Error('This shop is not in a free period'), { status: 409 });
    p.endsAt = new Date(now.getTime() - 1);
    p.freeUntil = undefined;
    p.history = [...(p.history || []).slice(-49), { at: now, by, from: p.id, to: p.id, note: 'free period ended by hand' }];
    delete p.notified;
    await Tenant.updateOne({ _id: tenantDoc._id }, { $set: { plan: p } });
    tenantDoc.plan = p;
    invalidateTenant(tenantDoc.slug);
    await require('./brandPlan').afterPlanChange(tenantDoc);
    return viewOf(tenantDoc, now);
}

// Turn a feature outside the plan on or off for one shop (a tagged "extra")
async function setExtra(tenantDoc, key, on, by = 'supreme') {
    await require('./brandPlan').guardBranch(tenantDoc);
    if (!plans.FEATURES[key]) throw Object.assign(new Error('Unknown feature'), { status: 400 });
    const p = tenantDoc.plan || {};
    if (!p.id) throw Object.assign(new Error('This shop has no plan yet'), { status: 400 });
    const rest = (p.extras || []).filter((e) => e.key !== key);
    p.extras = on && !plans.planIncludes(p.id, key) ? [...rest, { key, at: new Date(), by }] : rest;
    await Tenant.updateOne({ _id: tenantDoc._id }, { $set: { plan: p } });   // loadTenant hands over a plain object, so write with updateOne
    tenantDoc.plan = p;
    invalidateTenant(tenantDoc.slug);
    await require('./brandPlan').afterPlanChange(tenantDoc);
    return viewOf(tenantDoc);
}

// per-shop amount / free days / fee slabs and the web + native switches (null clears an override)
async function setShopTerms(tenantDoc, b) {
    if (b.pricePaise !== undefined || b.freeDays !== undefined || b.feeSlabs !== undefined) await require('./brandPlan').guardBranch(tenantDoc);   // price and free days belong to the main shop; the website and app switches are per shop
    const bad = (m) => Object.assign(new Error(m), { status: 400 });
    const p = tenantDoc.plan || {};
    if (b.pricePaise !== undefined) { if (b.pricePaise !== null && !INT(b.pricePaise, 0, 100000000)) throw bad('Price must be whole paise'); p.priceOverridePaise = b.pricePaise ?? undefined; }
    if (b.freeDays !== undefined) { if (b.freeDays !== null && !INT(b.freeDays, 0, 365)) throw bad('Free days must be 0 to 365'); p.freeDaysOverride = b.freeDays ?? undefined; }
    if (b.feeSlabs !== undefined) { if (b.feeSlabs !== null) { const e = plans.checkFeeSlabs(b.feeSlabs); if (e) throw bad(e); } p.feeSlabsOverride = b.feeSlabs ?? undefined; }
    for (const k of ['webEnabled', 'nativeEnabled']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') throw bad(`${k} must be true or false`); p[k] = b[k]; }
    await Tenant.updateOne({ _id: tenantDoc._id }, { $set: { plan: p } });   // loadTenant hands over a plain object, so write with updateOne
    tenantDoc.plan = p;
    invalidateTenant(tenantDoc.slug);
    return viewOf(tenantDoc);
}

// the cheapest plan that includes a feature, for the "Available in Growth" notes: { costsProfit: 'Growth', analytics: 'Pro', ... }
const needsOf = () => Object.fromEntries(Object.keys(plans.FEATURES).map((k) => { const id = plans.PLAN_IDS.find((p) => plans.plansOf(k).includes(p)); return [k, id ? id.replace(/^./, (c) => c.toUpperCase()) : 'Pro']; }));

// reads the saved "what each plan includes" from the database into the catalog (called at start and every few seconds by planFeatureOverrides)
async function loadFeatureOverrides() {
    const s = await PlatformSettings.findById('main').select('plans.features').lean();
    plans.setFeatureOverrides(s?.plans?.features || {});
}

// Takes EVERY plan away from a shop: it has no plan again (nothing is limited, no reminders, no pause). The owner is asked to choose a plan.
// Per-shop terms (price, free days, fee slabs, website/app switches) stay. A payment that was waiting is closed.
async function removePlan(tenantDoc, { by = 'supreme' } = {}) {
    await require('./brandPlan').guardBranch(tenantDoc);
    const from = tenantDoc.plan?.id || null;
    if (!from) throw Object.assign(new Error('This shop has no plan'), { status: 409 });
    const now = new Date();
    const p = { ...(tenantDoc.plan || {}) };
    const history = [...(p.history || []).slice(-49), { at: now, by, from, to: null, note: 'plan removed' }];
    for (const k of ['id', 'startedAt', 'endsAt', 'freeUntil', 'scheduled', 'paused', 'notified', 'extras', 'migration']) delete p[k];
    p.history = history;
    await Tenant.updateOne({ _id: tenantDoc._id }, { $set: { plan: p } });
    await require('../models/PlanPayment').updateMany({ tenantId: tenantDoc._id, status: 'pending' }, { $set: { status: 'expired' } });
    tenantDoc.plan = p;
    invalidateTenant(tenantDoc.slug);
    await require('./brandPlan').afterPlanChange(tenantDoc);
    require('./planLifecycle').notifyRemoved({ tenantId: tenantDoc._id, from, by });
    return viewOf(tenantDoc, now);
}

// How a shop would look on `to`: built from the SAME catalog the server gates with, so the picture and the real thing cannot drift apart.
// tenant (optional) gives the shop's own price, free days and extras; `current` is what it has now, for the "changes" lists.
async function previewOf(tenant, to, { freeDays } = {}) {
    if (!plans.isPlan(to)) throw Object.assign(new Error('Plan must be partner, growth or pro'), { status: 400 });
    const def = await getDefaults();
    const p = tenant?.plan || {};
    const extras = (p.extras || []).map((e) => e.key).filter((k) => !plans.planIncludes(to, k));   // extras still outside the new plan stay (keepExtras default)
    const has = (k) => plans.planIncludes(to, k) || extras.includes(k);
    const days = freeDays ?? p.freeDaysOverride ?? def.freeDays;
    const now = new Date();
    const price = to === 'partner' ? 0 : (p.priceOverridePaise ?? def[to].pricePaise);
    const endsAt = to === 'partner' || !(days > 0) ? null : endOfIstDay(now, days - 1);
    const menu = plans.OWNER_MENU.map((r) => {
        const on = r.only ? to === r.only : r.feature ? has(r.feature) : true;
        return { route: r.route, title: r.title, state: on ? 'on' : r.only || r.hiddenWhenOff ? 'hidden' : 'locked', needs: !on && r.feature ? needsOf()[r.feature] : null };
    });
    const cur = p.id || null;
    const had = (k) => !cur || plans.planIncludes(cur, k) || (p.extras || []).some((e) => e.key === k);
    const label = (k) => plans.FEATURES[k].label;
    return {
        plan: to, name: to[0].toUpperCase() + to.slice(1),
        header: { line: endsAt ? `${to[0].toUpperCase() + to.slice(1)}, ends ${endsAt.toISOString().slice(0, 10)}` : to[0].toUpperCase() + to.slice(1), endsAt, freeDays: to === 'partner' ? 0 : days, pricePaise: price, perOrderFee: to === 'partner' ? { minRs: def.partner.feeMinRs, maxRs: def.partner.feeMaxRs } : null },
        features: Object.fromEntries(Object.keys(plans.FEATURES).map((k) => [k, has(k)])),   // the plan plus the extras the shop keeps
        ownerMenu: menu,
        customer: {
            tracking: has('riderLiveMap') ? 'live_map' : 'timeline',   // Partner customers see the order timeline, not the rider on a map; the rider's name and Call button stay
            riderCallButton: true, tableBooking: true, dineInQr: true, webAndApp: true,
            loyalty: has('loyalty'), services: has('services'),
        },
        limits: { riders: plans.limitFor(to, 'riders'), staff: has('staffLogins') && plans.limitFor(to, 'staff') === 0 ? plans.limitFor('growth', 'staff') : plans.limitFor(to, 'staff') },
        other: {
            soundboxVoice: has('soundboxVoice'), autoAccept: has('autoAccept'), costsProfit: has('costsProfit'), analytics: has('analytics'), customPush: has('customPush'),
            multiBranch: has('multiBranch'), customDomain: has('customDomain'), exports: has('fullExports') ? 'everything' : 'money columns only',
        },
        extras,
        changes: {
            on: Object.keys(plans.FEATURES).filter((k) => has(k) && !had(k)).map(label),
            off: cur ? Object.keys(plans.FEATURES).filter((k) => !has(k) && had(k)).map(label) : [],
        },
    };
}

module.exports = { endFree, previewOf, needsOf, getDefaults, saveDefaults, viewOf, setPlan, setExtra, setShopTerms, endOfIstDay, removePlan, loadFeatureOverrides };
