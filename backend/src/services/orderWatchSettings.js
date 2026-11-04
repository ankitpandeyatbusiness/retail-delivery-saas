// The limits behind the Orders tab: when an order counts as stuck, when YOU are alerted, and when a shop "needs a talk".
// Kept in PlatformSettings.orderWatch; anything not set uses the default below. Cached for 20 seconds.
const PlatformSettings = require('../models/PlatformSettings');
const { httpError } = require('../middlewares/apiErrors');

// [default, min, max]
const SPEC = {
    attention: { accept: [5, 1, 60], cooking: [60, 10, 300], noRider: [10, 2, 120], onWay: [60, 10, 300], payment: [15, 5, 120] },
    alert: { notAccepted: [10, 2, 120], notStarted: [40, 5, 600], slowPrep: [90, 10, 600], noRider: [30, 5, 300], onWay: [120, 15, 600] },
    talk: { shopCancelPct: [10, 1, 100], prepMin: [45, 10, 240], deliveryMin: [50, 10, 240], complaintPct: [8, 1, 100], minOrders: [10, 3, 200] },
};

const defaults = () => Object.fromEntries(Object.entries(SPEC).map(([g, f]) => [g, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[0]]))]));

let cache = null;
async function get() {
    if (cache && Date.now() - cache.at < 20000) return cache.value;
    const row = await PlatformSettings.findById('main').select('orderWatch').lean().catch(() => null);
    const value = defaults();
    for (const g of Object.keys(SPEC)) for (const k of Object.keys(SPEC[g])) {
        const n = row?.orderWatch?.[g]?.[k];
        if (Number.isInteger(n) && n >= SPEC[g][k][1] && n <= SPEC[g][k][2]) value[g][k] = n;
    }
    cache = { at: Date.now(), value };
    return value;
}

// body: { attention?: {accept...}, alert?: {...}, talk?: {...} }; a bad value is refused with its name. "reset: true" goes back to the defaults.
async function set(body) {
    const b = body || {};
    const $set = {};
    if (b.reset === true) {
        await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { orderWatch: 1 } });
        cache = null;
        return get();
    }
    for (const g of Object.keys(b)) {
        if (g === 'reset') continue;
        if (!SPEC[g]) throw httpError(400, `Unknown group: ${g}`);
        for (const [k, v] of Object.entries(b[g] || {})) {
            if (!SPEC[g][k]) throw httpError(400, `Unknown setting: ${k}`);
            const [, min, max] = SPEC[g][k];
            if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${k} must be a whole number from ${min} to ${max}`);
            $set[`orderWatch.${g}.${k}`] = v;
        }
    }
    if (!Object.keys($set).length) throw httpError(400, 'Nothing to change');
    if ($set['orderWatch.alert.notAccepted'] !== undefined || $set['orderWatch.attention.accept'] !== undefined) { /* each is checked on its own: they are separate limits */ }
    await PlatformSettings.updateOne({ _id: 'main' }, { $set }, { upsert: true });
    cache = null;
    return get();
}

module.exports = { get, set, defaults, SPEC };
