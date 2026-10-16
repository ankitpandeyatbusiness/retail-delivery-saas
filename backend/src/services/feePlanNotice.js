// Tells shop owners when their monthly fee plan changes (an in-app message, a push and the usual inbox entry).
//   platformChanged(old, new)  the platform's tiers changed: every active shop that uses them (not a shop with its own plan)
//   shopChanged(tenantId, plan) one shop's own plan (tiers or fixed fee) was set or removed
// Only invoices made from now on use a new plan; bills already issued never change.
const Tenant = require('../models/Tenant');
const PlatformSettings = require('../models/PlatformSettings');
const notify = require('./notificationService');
const { tierTable, resolveTiers, DEFAULT_TIERS } = require('../utils/billingRules');

const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;
const tableText = (tiers) => tierTable(tiers).map((r) => `${r.label}: ${rs(r.fee)}`).join(', ');
const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

const send = (tenantId, body) => notify.toOwner(tenantId, {
    type: 'platform_message', title: 'Your monthly fee plan changed', body, data: { kind: 'fee_plan' },
}).catch((e) => console.error('Fee plan notice error:', e.message));

async function platformChanged(oldTiers, newTiers) {
    if (same(oldTiers || DEFAULT_TIERS, newTiers)) return { told: 0 };
    const body = `Monthly fee by delivered orders: ${tableText(newTiers)}. It applies to bills made from now on; bills already issued do not change.`;
    const shops = await Tenant.find({
        status: 'active',
        $and: [
            { $or: [{ 'billing.tiersOverride': { $exists: false } }, { 'billing.tiersOverride': { $size: 0 } }, { 'billing.tiersOverride': null }] },
            { $or: [{ 'billing.fixedFeeOverride': { $exists: false } }, { 'billing.fixedFeeOverride': null }] },
        ],
    }).select('_id').lean();
    // in the background: the owner who changed the plan does not wait for hundreds of shops
    setImmediate(async () => { for (const s of shops) await send(s._id, body); });
    return { told: shops.length };
}

async function shopChanged(tenantId, platformTiers) {
    const t = await Tenant.findById(tenantId).select('billing').lean();
    const platform = platformTiers ? { billing: { tiers: platformTiers } } : await PlatformSettings.findById('main').lean();
    const fixed = t?.billing?.fixedFeeOverride;
    const body = Number.isFinite(fixed)
        ? `Your monthly fee is now a fixed ${rs(fixed)}. It applies to bills made from now on.`
        : `Monthly fee by delivered orders: ${tableText(resolveTiers(t, platform))}. It applies to bills made from now on.`;
    await send(tenantId, body);
    return { told: 1 };
}

module.exports = { platformChanged, shopChanged };
