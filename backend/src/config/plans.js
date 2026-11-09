// The plan catalog: the ONE place that says what Partner, Growth and Pro include. The server gates on it (services/featureGate.js hasFeature)
// and the apps read it from GET /api/admin/plans (superadmin) so both always agree. Prices are defaults; the supremeadmin edits them in the More tab.
// Money is integer paise.

const PLAN_IDS = ['partner', 'growth', 'pro'];

// feature key -> the plans that include it
const FEATURES = {
    riderLiveMap: { label: 'Rider live map for customers', plans: ['growth', 'pro'] },
    soundboxVoice: { label: 'Soundbox voice (app only)', plans: ['growth', 'pro'] },
    services: { label: 'Services and inquiries', plans: ['growth', 'pro'] },
    loyalty: { label: 'Loyalty and rewards', plans: ['growth', 'pro'] },
    autoAccept: { label: 'Auto-accept orders', plans: ['growth', 'pro'] },
    costsProfit: { label: 'Costs and profit view', plans: ['growth', 'pro'] },
    staffLogins: { label: 'Kitchen and waiter logins', plans: ['growth', 'pro'] },
    bulkOrders: { label: 'Bulk orders', plans: ['pro'] },
    fullExports: { label: 'Full exports (customers, orders, items, reports)', plans: ['pro'] },
    analytics: { label: 'Business analytics and PDF reports', plans: ['pro'] },
    customPush: { label: 'Custom and daily automatic push', plans: ['pro'] },
    multiBranch: { label: 'Multi-branch', plans: ['pro'] },
    customDomain: { label: 'Custom domain', plans: ['pro'] },
};

// numbers that differ by plan (null = unlimited)
const LIMITS = {
    riders: { partner: 2, growth: null, pro: null },
    staff: { partner: 0, growth: 5, pro: null },
};

const DEFAULTS = {
    partner: { name: 'Partner', pricePaise: 0, feeMinRs: 3, feeMaxRs: 15 },
    growth: { name: 'Growth', pricePaise: 299900 },
    pro: { name: 'Pro', pricePaise: 499900 },
    // Partner per-order fee by the order value at checkout: up to `upTo` rupees = `feeRs`. The last slab has upTo: null.
    feeSlabs: [
        { upTo: 150, feeRs: 3 }, { upTo: 300, feeRs: 6 }, { upTo: 500, feeRs: 9 }, { upTo: 800, feeRs: 12 }, { upTo: null, feeRs: 15 },
    ],
    freeDays: 30,
    graceDays: 3,
    gstPercent: 18,
    // Partner wallet: how far below zero a fee may push it, top-up limits and packs (paise), and the "low" warning (% of the last top-up)
    overdraftPaise: 10000, minTopupPaise: 10000, maxTopupPaise: 2000000, packsPaise: [30000, 50000, 100000], walletLowPercent: 20,
    includedBranches: 2,
    branchAddonPaise: 149900,
    // multi-month prepay discount by months (percent)
    monthDiscounts: { 1: 0, 2: 0, 3: 5, 4: 6, 5: 8, 6: 10 },
};

const isPlan = (id) => PLAN_IDS.includes(id);

// does this plan include the feature? An unknown feature key is not plan-gated (true).
function planIncludes(planId, key) {
    const f = FEATURES[key];
    if (!f) return true;
    return f.plans.includes(planId);
}

function limitFor(planId, what) {
    const l = LIMITS[what];
    return l && planId in l ? l[planId] : null;
}

// the features a plan turns on, as { key: true }
const featuresOf = (planId) => Object.keys(FEATURES).reduce((o, k) => { o[k] = planIncludes(planId, k); return o; }, {});

// Validate fee slabs: 1-10 rows, upTo ascending whole rupees, last upTo null, fee 3-15 whole rupees.
function checkFeeSlabs(slabs) {
    if (!Array.isArray(slabs) || !slabs.length || slabs.length > 10) return 'Fee slabs: send 1 to 10 rows';
    let prev = 0;
    for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i] || {};
        const last = i === slabs.length - 1;
        if (!Number.isInteger(s.feeRs) || s.feeRs < 3 || s.feeRs > 15) return `Slab ${i + 1}: the fee must be a whole number from Rs 3 to Rs 15`;
        if (last) { if (s.upTo !== null) return 'The last slab must be open ended (upTo empty)'; }
        else {
            if (!Number.isInteger(s.upTo) || s.upTo <= prev) return `Slab ${i + 1}: "up to" must be a whole rupee amount above the previous slab`;
            prev = s.upTo;
        }
    }
    return null;
}

module.exports = { PLAN_IDS, FEATURES, LIMITS, DEFAULTS, isPlan, planIncludes, limitFor, featuresOf, checkFeeSlabs };
