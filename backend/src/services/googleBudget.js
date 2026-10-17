// A monthly allowance for every paid Google call, so the bill can never pass the free tier.
//
//   if (await budget.take('text_search', cap)) { ...call Google... } else { ...use the free source... }
//
//   - a monthly counter per call type (Indian month), taken with ONE atomic step and given back when it is over the cap
//   - a daily pace on top: one day may use about `pace` times its fair share (cap / days in the month), so a busy
//     start of the month cannot leave the last week without Google. The day counter is given back when it is over.
//   - the caps are PlatformSettings.tracking.* (the supreme admin changes them), read through trackingGuard.
const Counter = require('../models/Counter');
const guard = require('./trackingGuard');

const DAILY_FLOOR = 20;   // a tiny cap (tests, a new shop) is never blocked by the daily pace

// the caps the supreme admin can change. `stage` is what the call is used for.
const CAPS = {
    route_pro: { field: 'routeProCap', label: 'Road route with traffic (best)', pace: 3 },
    route_ess: { field: 'routeCap', label: 'Road route, no traffic', pace: 3, key: 'routes' },   // `routes:` is the older counter key
    text_search: { field: 'textSearchCap', label: 'Place search by name (best)', pace: 2 },
    autocomplete: { field: 'autocompleteCap', label: 'Place suggestions while typing', pace: 2 },
    details: { field: 'detailsCap', label: 'Address and point of the picked place', pace: 2 },
};

const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000);
const monthOf = (d) => ist(d).toISOString().slice(0, 7);
const dayOf = (d) => ist(d).toISOString().slice(0, 10);
const daysInMonth = (d) => { const x = ist(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); };
const base = (sku) => CAPS[sku].key || `g:${sku}`;
const monthKey = (sku, d) => `${base(sku)}:${monthOf(d)}`;
const dayKey = (sku, d) => `${base(sku)}:d:${dayOf(d)}`;

async function capOf(sku) {
    const s = await guard.loadedSettings();
    const v = s[CAPS[sku].field];
    return Number.isFinite(v) ? v : 0;
}

const bump = (id, by) => Counter.findOneAndUpdate({ _id: id }, { $inc: { seq: by } }, { returnDocument: 'after', upsert: true });

// true = you may make one call (it is counted). false = out of allowance, use the free source.
// `share` (0..1) lets a low-priority caller use only part of the cap (the superadmin's own searches use half).
async function take(sku, { share = 1, now = new Date() } = {}) {
    const def = CAPS[sku];
    if (!def) return false;
    const cap = Math.floor((await capOf(sku)) * share);
    if (!(cap > 0)) return false;
    const mk = monthKey(sku, now);
    const dk = dayKey(sku, now);
    const m = await bump(mk, 1);
    if (m.seq > cap) { await bump(mk, -1); return false; }
    const dailyLimit = Math.max(DAILY_FLOOR, Math.ceil((cap / daysInMonth(now)) * def.pace));
    const d = await bump(dk, 1);
    if (d.seq > dailyLimit) { await bump(dk, -1); await bump(mk, -1); return false; }
    return true;
}

// is there allowance left? (does not count anything)
async function hasLeft(sku, { share = 1, now = new Date() } = {}) {
    if (!CAPS[sku]) return false;
    const cap = Math.floor((await capOf(sku)) * share);
    if (!(cap > 0)) return false;
    const c = await Counter.findById(monthKey(sku, now)).lean();
    return (c?.seq || 0) < cap;
}

async function usage(now = new Date()) {
    const out = {};
    for (const sku of Object.keys(CAPS)) {
        const [m, cap] = await Promise.all([Counter.findById(monthKey(sku, now)).lean(), capOf(sku)]);
        out[sku] = { label: CAPS[sku].label, used: m?.seq || 0, cap };
    }
    return out;
}

module.exports = { take, hasLeft, usage, CAPS };
