// Billing rules in one place. No database calls, so it is easy to test.
// Money here is in rupees, like the rest of the rent code.

const DEFAULT_TIERS = [
    { upTo: 305, fee: 3000 },
    { upTo: 1005, fee: 6000 },
    { upTo: null, fee: 10000 },
];

// Checks a tier list from the panel. The last tier must be open ended (upTo null).
function validateTiers(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 10) {
        return { ok: false, errors: ['Send 1 to 10 tiers'], clean: [] };
    }
    const errors = [];
    const clean = [];
    let prev = -1;
    input.forEach((t, i) => {
        const last = i === input.length - 1;
        const fee = Number(t?.fee);
        if (!Number.isFinite(fee) || fee < 0) errors.push(`Tier ${i + 1}: fee must be a number, 0 or more`);
        if (last) {
            if (t?.upTo !== null && t?.upTo !== undefined) errors.push('The last tier must be open ended (upTo empty)');
            clean.push({ upTo: null, fee });
        } else {
            const upTo = t?.upTo;
            if (!Number.isInteger(upTo) || upTo <= prev) errors.push(`Tier ${i + 1}: upTo must be a whole number bigger than the tier before`);
            else prev = upTo;
            clean.push({ upTo, fee });
        }
    });
    return { ok: errors.length === 0, errors, clean };
}

// shop tiers first, then platform tiers, then the built-in default
function resolveTiers(tenant, platform) {
    const own = tenant?.billing?.tiersOverride;
    if (Array.isArray(own) && own.length) return own;
    const global = platform?.billing?.tiers;
    if (Array.isArray(global) && global.length) return global;
    return DEFAULT_TIERS;
}

// Fee and a readable label for a number of delivered orders in one month
function feeForCount(tiers, count) {
    let from = 0;
    for (const t of tiers) {
        const open = t.upTo === null || t.upTo === undefined;
        if (open || count <= t.upTo) {
            return { fee: t.fee, label: open ? `${from}+ orders` : `${from} to ${t.upTo} orders` };
        }
        from = t.upTo + 1;
    }
    const t = tiers[tiers.length - 1];
    return { fee: t.fee, label: `${from}+ orders` };
}

// Free service is worked out live. Free while delivered orders < limit AND now is before go-live + months.
// Raising a limit later reopens free service.
function freeStatus(tenant, platform, now = new Date()) {
    const b = tenant?.billing || {};
    const pb = platform?.billing || {};
    const freeOrders = b.freeOrdersOverride ?? pb.freeOrders ?? 100;
    const freeMonths = b.freeMonthsOverride ?? pb.freeMonths ?? 2;
    const start = new Date(b.goLiveAt || tenant?.createdAt || now);
    const endsAt = new Date(start);
    endsAt.setUTCMonth(endsAt.getUTCMonth() + freeMonths);
    const delivered = b.deliveredCount || 0;
    return {
        free: delivered < freeOrders && now < endsAt,
        freeOrders,
        freeMonths,
        endsAt,
        ordersLeft: Math.max(freeOrders - delivered, 0),
    };
}

// fixed fee override wins, then tiers
function resolveFee(tenant, platform, orderCount) {
    const fixed = tenant?.billing?.fixedFeeOverride;
    if (fixed !== null && fixed !== undefined) return { fee: fixed, label: 'Fixed monthly fee' };
    return feeForCount(resolveTiers(tenant, platform), orderCount);
}

module.exports = { DEFAULT_TIERS, validateTiers, resolveTiers, feeForCount, freeStatus, resolveFee };