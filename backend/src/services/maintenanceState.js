// What maintenance means for ONE shop right now. One rule for the whole-platform switch, a shop's own switch and a planned maintenance.
//
//   off        nothing is paused.
//   draining   maintenance is on, but the shop still has work running (an order being made, a delivery on the road, a pickup waiting, an open table bill).
//              NO NEW WORK can start (no new order, request, booking, table visit), but everything that finishes the running work keeps working for
//              the owner, the cook, the waiter, the rider and the customer. Nothing hangs in the middle.
//   offline    maintenance is on and nothing is running (or the safety limit passed): every change is refused, except the few that let a person
//              finish or cancel an order that already exists, keep the sign-in alive, and read messages. Reading (GET) always works, so the apps can
//              show the maintenance badge and the grey screen.
//
// A shop is never kept "draining" for ever: after DRAIN_CAP_MS it counts as offline (one stuck order, a customer who never collects, a rider whose phone
// died must not keep it open). Even then a rider and a customer can still finish or cancel the orders that exist (ALWAYS_OK).
const PlatformSettings = require('../models/PlatformSettings');
const Order = require('../models/Order');
const { isMaintenanceOn, maintenanceBody } = require('../utils/maintenance');
const { ACTIVE_STATUSES } = require('./orderflow');
const { HIDE_UNPAID } = require('./onlineOrder');

const DRAIN_CAP_MS = 2 * 60 * 60 * 1000;
const FAR_BULK_MS = 24 * 60 * 60 * 1000;   // a paid bulk order for a day that is more than a day away is not "running" yet

/* ------------------------------ the whole-platform switch (read at most every 15 s) ------------------------------ */
const platformCache = { at: 0, value: null };
async function platformMaintenance() {
    if (Date.now() - platformCache.at < 15 * 1000) return platformCache.value;
    const doc = await PlatformSettings.findById('main').select('maintenance').lean();
    platformCache.at = Date.now();
    platformCache.value = doc?.maintenance || null;
    return platformCache.value;
}
const invalidatePlatform = () => { platformCache.at = 0; };

/* ------------------------------ what is running in a shop (read at most every 8 s) ------------------------------ */
const workCache = new Map();
async function runningWork(tenantId, now = Date.now()) {
    const key = String(tenantId);
    const hit = workCache.get(key);
    if (hit && now - hit.at < 8000) return hit.n;
    const farBulk = { bulkId: { $exists: true }, scheduledFor: { $gt: new Date(now + FAR_BULK_MS) } };
    const n = await Order.countDocuments({
        tenantId, ...HIDE_UNPAID, $nor: [farBulk],
        $or: [
            { status: { $in: ACTIVE_STATUSES } },   // waiting for the shop, being made, ready (a pickup waits for its customer), on the road
            { orderType: 'dine_in', tableSessionId: { $exists: true }, status: 'delivered', 'payment.status': { $ne: 'paid' } },   // a table bill still to be paid
        ],
    });
    workCache.set(key, { at: now, n });
    if (workCache.size > 2000) workCache.clear();
    return n;
}
const forgetWork = (tenantId) => workCache.delete(String(tenantId));

/* ------------------------------ the state ------------------------------ */
// tenant: { _id, maintenance } (the shop's own switch). Returns { on:false } or { on:true, scope, message, until, since, planId, running, draining, offline }
async function stateOf(tenant, now = new Date()) {
    const tm = tenant && tenant.maintenance;
    const pm = await platformMaintenance();
    const tOn = isMaintenanceOn(tm, now);
    const pOn = isMaintenanceOn(pm, now);
    if (!tOn && !pOn) return { on: false };
    const src = tOn ? tm : pm;
    const since = src.since ? new Date(src.since) : null;
    const running = tenant && tenant._id ? await runningWork(tenant._id, now.getTime()) : 0;
    const capped = !!since && now.getTime() - since.getTime() > DRAIN_CAP_MS;
    const draining = running > 0 && !capped;
    return { on: true, scope: tOn ? 'shop' : 'platform', message: src.message || '', until: src.until || null, since, planId: src.planId || null, running, draining, offline: !draining };
}

/* ------------------------------ which requests are "new work" ------------------------------ */
// While a shop drains these are refused; everything else keeps working. (Customers only: nobody else can start new work.)
const NEW_WORK = [
    /^\/api\/orders\/?$/,                          // placing an order (a table order is placed the same way)
    /^\/api\/orders\/reorder/,
    /^\/api\/dinein\/scan\/?$/, /^\/api\/dinein\/table\/[^/]+\/enter\/?$/,   // starting a new table visit
    /^\/api\/bulk\/?$/, /^\/api\/bulk\/[^/]+\/pay\/?$/,                      // a new bulk request, and paying its advance
    /^\/api\/bookings\/?$/, /^\/api\/bookings\/[^/]+\/pay\/?$/,              // a new table booking, and its deposit
    /^\/api\/services\/[^/]+\/inquiries/,          // a new inquiry
];
const pathOf = (req) => String(req.originalUrl || req.url || '').split('?')[0];   // the FULL path (inside a mounted router req.path is relative)
const isNewWork = (req) => req.method === 'POST' && NEW_WORK.some((re) => re.test(pathOf(req)));

// What stays allowed even when a shop is fully offline: sign-in upkeep, messages, a rider finishing or handing back a delivery, and a customer
// following, cancelling, paying for (verifying) or rating an order that already exists.
const ALWAYS_OK = [
    /^\/api\/auth\/(refresh|logout)\/?$/,
    /^\/api\/rider(\/|$)/,
    /^\/api\/orders\/[a-fA-F0-9]{24}(\/|$)/,       // an order that exists: its page, cancel, payment check, complaint, rating, pickup answer
    /^\/api\/notifications(\/|$)/, /^\/api\/me\/alerts(\/|$)/, /^\/api\/chat(\/|$)/,
    /^\/api\/dinein\/(pay-bill|owed\/pay|ask-bill|nudge|free|call|tip|feedback|leave-ask|presence|paid-claim)/,   // the guest of an open table: pay, ask for the bill, free the table
];
const alwaysOk = (req) => ALWAYS_OK.some((re) => re.test(pathOf(req)));

// The answer for a request: null = let it through, or the body of the 503 maintenance answer.
async function decide(req, tenant) {
    const st = await stateOf(tenant);
    if (!st.on) return null;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;   // reading always works: the apps show the badge and the grey screen from it
    if (alwaysOk(req)) return null;
    if (st.draining && !isNewWork(req)) return null;                    // running work can be finished
    return { ...maintenanceBody({ message: st.message, until: st.until }), draining: st.draining };
}

module.exports = { stateOf, decide, runningWork, forgetWork, platformMaintenance, invalidatePlatform, isNewWork, alwaysOk, DRAIN_CAP_MS };
