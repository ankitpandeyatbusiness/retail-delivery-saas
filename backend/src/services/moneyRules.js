// WHO BEARS THE COST when an order paid online is cancelled or not collected. The numbers (what share of the food the shop keeps)
// used to be fixed in the code; now:
//   - the SUPER ADMIN sets the platform rules (PlatformSettings.moneyRules). "Use recommended" puts the recommended ones back.
//   - the SHOP OWNER sees them and may be MORE generous to customers: a lower share kept, or a longer free time. He can never keep more
//     than the platform allows. His own choice is tenant.settings.orders.cancelRules. "Use recommended" removes it (he follows the platform).
//   - the rules that apply to an order are worked out here (forTenant) and handed to the pure refund maths.
// Cash orders have nothing to refund, so these numbers matter for orders paid online.
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const { RECOMMENDED } = require('./refundService');

const KEYS = ['graceMinutes', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'noShow'];
const fail = (m) => Object.assign(new Error(m), { status: 400 });

function num(v, name, min, max) {
    const n = Number(v);
    if (typeof v === 'boolean' || v === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) throw fail(`${name} must be a whole number from ${min} to ${max}`);
    return n;
}

// checks a full set of rules. Returns it clean.
function clean(b) {
    const r = {
        graceMinutes: num(b?.graceMinutes, 'Free time after accepting (minutes)', 0, 30),
        accepted: num(b?.accepted, 'Share kept after the shop accepted (%)', 0, 100),
        preparing: num(b?.preparing, 'Share kept while it is being prepared (%)', 0, 100),
        ready: num(b?.ready, 'Share kept when it is ready (%)', 0, 100),
        out_for_delivery: num(b?.out_for_delivery, 'Share kept when it is on the road (%)', 0, 100),
        noShow: num(b?.noShow, 'Share kept when the customer does not come or cannot be reached (%)', 0, 100),
    };
    if (!(r.accepted <= r.preparing && r.preparing <= r.ready && r.ready <= r.out_for_delivery)) throw fail('The share kept can only grow as the order moves on: accepted, preparing, ready, on the road');
    return r;
}

// the platform's rules (kept in memory a minute; refreshed on every save)
let platform = { ...RECOMMENDED };
let at = 0;
async function loadPlatform(force) {
    if (!force && Date.now() - at < 60000) return platform;
    try {
        const doc = await PlatformSettings.collection.findOne({ _id: 'main' }, { projection: { moneyRules: 1 } });
        platform = doc?.moneyRules ? { ...RECOMMENDED, ...doc.moneyRules } : { ...RECOMMENDED };
        at = Date.now();
    } catch (e) { /* the last known rules stay */ }
    return platform;
}
async function savePlatform(rules) {
    await PlatformSettings.collection.updateOne({ _id: 'main' }, { $set: { moneyRules: rules } }, { upsert: true });
    return loadPlatform(true);
}

// the shop may only be kinder: never keep more, never give less free time
function mix(plat, shop) {
    const out = { ...plat };
    if (!shop) return out;
    for (const k of KEYS) {
        if (shop[k] === undefined || shop[k] === null) continue;
        out[k] = k === 'graceMinutes' ? Math.max(plat[k], shop[k]) : Math.min(plat[k], shop[k]);
    }
    // keeping the order of the steps after the shop's lower numbers
    out.preparing = Math.max(out.preparing, out.accepted);
    out.ready = Math.max(out.ready, out.preparing);
    out.out_for_delivery = Math.max(out.out_for_delivery, out.ready);
    return out;
}

async function forTenant(tenantId) {
    const [plat, t] = await Promise.all([loadPlatform(), Tenant.findById(tenantId).select('settings.orders.cancelRules').lean()]);
    return mix(plat, t?.settings?.orders?.cancelRules);
}

// what the owner's screen shows
async function shopView(tenant) {
    const plat = await loadPlatform();
    const own = tenant?.settings?.orders?.cancelRules || null;
    return { platform: plat, own, effective: mix(plat, own), recommended: RECOMMENDED };
}

// the owner's choice, checked: each number only as kind or kinder than the platform's
function cleanShop(body, plat) {
    const merged = { ...plat, ...(body || {}) };
    const r = clean(merged);
    for (const k of KEYS) {
        if (k === 'graceMinutes' ? r[k] < plat[k] : r[k] > plat[k]) {
            throw fail(k === 'graceMinutes' ? `The free time cannot be less than the platform's ${plat[k]} minutes` : `You cannot keep more than the platform allows (${plat[k]}%) for this step`);
        }
    }
    return r;
}

module.exports = { KEYS, RECOMMENDED, clean, cleanShop, loadPlatform, savePlatform, mix, forTenant, shopView };
