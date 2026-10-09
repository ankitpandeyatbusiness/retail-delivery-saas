// Keeps each shop's billing state right: free, active, grace or paused.
// Runs every 5 minutes. Every update is repeatable, so it is safe if two servers run it.
//
//   unpaid bill, grace not over  -> state "grace"  (graceEndsAt = the earliest unpaid grace end)
//   unpaid bill, grace is over   -> state "paused" (new orders are refused)
//   no unpaid bill (paid, void)  -> back to "active" (the free check puts it back to "free" if needed)
//
// Old invoices made before this system have no graceEndsAt, so they never pause a shop.

const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const { syncFreeState } = require('./subscriptionService');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');

let running = false;

// the app reads a cached copy of the shop (60 seconds), so refresh it for shops that changed
async function refreshCache(ids) {
    if (!ids.length) return;
    const shops = await Tenant.find({ _id: { $in: ids } }).select('slug').lean();
    shops.forEach((s) => invalidateTenant(s.slug));
}

async function enforce(now = new Date()) {
    const platform = await PlatformSettings.findById('main').lean();

    // 1. keep free / active in line with the live free check
    const shops = await Tenant.find({ 'billing.state': { $nin: ['grace', 'paused'] } })
        .select('slug createdAt billing').lean();
    for (const t of shops) {
        try { await syncFreeState(t, platform, now); } catch (e) { console.error('Free state error:', e.message); }
    }

    // 2. shops with an unpaid bill that has a grace date
    const pending = await SubscriptionInvoice.aggregate([
        { $match: { status: 'pending', graceEndsAt: { $type: 'date' } } },
        { $group: { _id: '$tenantId', graceEndsAt: { $min: '$graceEndsAt' } } },
    ]);
    const changed = [];
    for (const p of pending) {
        const state = p.graceEndsAt <= now ? 'paused' : 'grace';
        const r = await Tenant.updateOne(
            { _id: p._id, $or: [{ 'billing.state': { $ne: state } }, { 'billing.graceEndsAt': { $ne: p.graceEndsAt } }] },
            { $set: { 'billing.state': state, 'billing.graceEndsAt': p.graceEndsAt } },
        );
        if (r.modifiedCount) changed.push(p._id);
    }

    // 3. shops in grace or paused that no longer owe anything
    const owing = pending.map((p) => p._id);
    const cleared = await Tenant.find({ 'billing.state': { $in: ['grace', 'paused'] }, _id: { $nin: owing } }).select('_id').lean();
    if (cleared.length) {
        const ids = cleared.map((c) => c._id);
        await Tenant.updateMany(
            { _id: { $in: ids }, 'billing.state': { $in: ['grace', 'paused'] } },
            { $set: { 'billing.state': 'active' }, $unset: { 'billing.graceEndsAt': 1 } },
        );
        changed.push(...ids);
    }

    await refreshCache(changed);
    return { changed: changed.length };
}

// Same rules as enforce(), for ONE shop, right now. The superadmin buttons call this
// so a paid, voided or extended bill takes effect at once (not after 5 minutes).
async function enforceTenant(tenantId, now = new Date()) {
    const id = new mongoose.Types.ObjectId(String(tenantId));
    const [owing] = await SubscriptionInvoice.aggregate([
        { $match: { tenantId: id, status: 'pending', graceEndsAt: { $type: 'date' } } },
        { $group: { _id: '$tenantId', graceEndsAt: { $min: '$graceEndsAt' } } },
    ]);
    if (owing) {
        await Tenant.updateOne({ _id: id }, {
            $set: { 'billing.state': owing.graceEndsAt <= now ? 'paused' : 'grace', 'billing.graceEndsAt': owing.graceEndsAt },
        });
    } else {
        await Tenant.updateOne(
            { _id: id, 'billing.state': { $in: ['grace', 'paused'] } },
            { $set: { 'billing.state': 'active' }, $unset: { 'billing.graceEndsAt': 1 } },
        );
        const t = await Tenant.findById(id).select('slug createdAt billing').lean();
        if (t) await syncFreeState(t, await PlatformSettings.findById('main').lean(), now);   // back to "free" if a limit was raised
    }
    await refreshCache([id]);
}

function startBillingEnforcementScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await enforce();
            if (r.changed) console.log(`Billing enforcement: ${r.changed} shop(s) changed state`);
        } catch (e) {
            console.error('Billing enforcement error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 30 * 1000).unref?.();
    setInterval(run, 5 * 60 * 1000).unref?.();
}

module.exports = { enforce, enforceTenant, startBillingEnforcementScheduler };