// Monthly app-rent invoices (you -> each shop).
//
// How billing works:
//   - A shop is FREE until it has delivered "freeOrders" orders OR "freeMonths" months have passed since go-live.
//   - After that, rent is billed in arrears: on the 1st we invoice the month that just finished,
//     using the real number of delivered orders and the tier table (a shop's own tiers or fixed fee win).
//   - The month in which free service ended is never billed (it was free or partly free).
//   - A new bill gives the shop "graceDays" of grace. After that billingEnforcement pauses the shop.
// Creating invoices is safe to repeat: a shop can never get two monthly invoices for the same month.

const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const Counter = require('../models/Counter');
const { freeStatus, resolveFee } = require('../utils/billingRules');

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------ periods ("2026-10", Indian time) ------------------------------ */
function periodOf(date) {
    const d = new Date(date.getTime() + IST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// the month before the one that "now" is in
function previousPeriod(now = new Date()) {
    const [y, m] = periodOf(now).split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Indian financial year (April to March): "2026-10" -> "2026-27", "2027-02" -> "2026-27"
function financialYear(period) {
    const [y, m] = period.split('-').map(Number);
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const periodStart = (period) => new Date(`${period}-01T00:00:00+05:30`);

const monthLabel = (period) =>
    periodStart(period).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

// The first month that is fully billable after free service ended.
// If free service ended in the middle of a month, that month is skipped.
function firstBillablePeriod(freeEndedAt) {
    const d = new Date(freeEndedAt);
    const p = periodOf(d);
    return d.getTime() <= periodStart(p).getTime() ? p : nextPeriod(p);
}

/* ------------------------------ free / active state ------------------------------ */
// When did free service end? At the time limit if that has passed, otherwise right now (the order limit was reached).
const freeEndMoment = (fs, now) => (now.getTime() >= fs.endsAt.getTime() ? fs.endsAt : now);

// Keeps billing.state right for a shop that is not in grace or paused: "free" or "active".
// Stores freeEndedAt when free service ends, and clears it if a raised limit reopens free service.
// Every update is filtered, so a shop that just went into grace or paused is never overwritten.
async function syncFreeState(tenant, platform, now = new Date()) {
    const b = tenant.billing || {};
    if (b.state === 'grace' || b.state === 'paused') return b.state;

    const fs = freeStatus(tenant, platform, now);
    const want = fs.free ? 'free' : 'active';
    const set = {};
    const unset = {};
    if (b.state !== want) set['billing.state'] = want;
    if (fs.free) {
        if (b.freeEndedAt) unset['billing.freeEndedAt'] = 1;
    } else if (!b.freeEndedAt) {
        set['billing.freeEndedAt'] = freeEndMoment(fs, now);
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (!Object.keys(update).length) return want;

    await Tenant.updateOne({ _id: tenant._id, 'billing.state': { $nin: ['grace', 'paused'] } }, update);
    return want;
}

/* ------------------------------ creating one invoice ------------------------------ */
// Returns { invoice } when created, or { skip: "reason" } when nothing was needed.
async function buildInvoice(tenant, period, platform, now = new Date()) {
    const skip = (reason) => ({ skip: reason });
    const sub = tenant.subscription || {};

    if (period >= periodOf(now)) return skip('month_not_finished');           // billing is in arrears
    if (sub.startMonth && period < sub.startMonth) return skip('before_start_month');

    try { await syncFreeState(tenant, platform, now); } catch (e) { console.error('Free state error:', e.message); }

    const fs = freeStatus(tenant, platform, now);
    if (fs.free) return skip('in_free_service');
    const endedAt = tenant.billing?.freeEndedAt || freeEndMoment(fs, now);
    if (period < firstBillablePeriod(endedAt)) return skip('free_or_partly_free_month');

    // old invoices have no "kind", so "not custom" is the safe check
    if (await SubscriptionInvoice.exists({ tenantId: tenant._id, period, kind: { $ne: 'custom' } })) return skip('already_invoiced');

    const b = platform?.business || {};
    if (!b.legalName) return skip('business_details_missing');                  // fill PUT /api/admin/platform/business first

    const orderCount = await Order.countDocuments({
        tenantId: tenant._id, status: 'delivered',
        deliveredAt: { $gte: periodStart(period), $lt: periodStart(nextPeriod(period)) },
    });
    const { fee, label } = resolveFee(tenant, platform, orderCount);
    if (!(fee > 0)) return skip('no_fee');

    // GST only if you have a GSTIN
    const gstPercent = b.gstin ? (sub.gstPercent ?? 18) : 0;
    const gstAmount = round2((fee * gstPercent) / 100);
    const total = round2(fee + gstAmount);

    const issueDate = now;
    const dueDate = new Date(issueDate.getTime() + (platform?.billing?.dueDays ?? 7) * DAY_MS);
    const graceEndsAt = new Date(issueDate.getTime() + (platform?.billing?.graceDays ?? 5) * DAY_MS);

    const fy = financialYear(periodOf(issueDate));   // invoice numbers follow the date the invoice is issued
    const counter = await Counter.findOneAndUpdate({ _id: `subinv:${fy}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    const invoiceNo = `SUB/${fy}/${String(counter.seq).padStart(4, '0')}`;

    const biz = tenant.business || {};
    const addr = tenant.address || {};
    let invoice;
    try {
        invoice = await SubscriptionInvoice.create({
            tenantId: tenant._id,
            kind: 'monthly',
            period,
            invoiceNo,
            issueDate,
            dueDate,
            graceEndsAt,
            description: `App subscription for ${monthLabel(period)}`,
            lineItems: [{
                description: `App subscription - ${monthLabel(period)} - ${orderCount} delivered orders (${label})`,
                qty: 1, rate: fee, amount: fee,
            }],
            orderCount,
            tierLabel: label,
            baseAmount: fee,
            gstPercent,
            gstAmount,
            total,
            seller: {
                legalName: b.legalName, address: b.address, gstin: b.gstin, email: b.email, phone: b.phone,
                sacCode: b.sacCode, paymentInstructions: b.paymentInstructions,
            },
            buyer: {
                legalName: biz.legalName || tenant.name,
                address: [addr.line, addr.city, addr.pincode].filter(Boolean).join(', '),
                gstin: biz.gstin,
                phone: tenant.phone,
            },
        });
    } catch (e) {
        // give the number back so invoice numbers stay continuous (only if no one took the next one)
        await Counter.updateOne({ _id: `subinv:${fy}`, seq: counter.seq }, { $inc: { seq: -1 } });
        if (e.code === 11000) return skip('already_invoiced');   // someone else created it a moment ago
        throw e;
    }

    // start the grace countdown at once (loaded here to avoid a circular require)
    require('./billingEnforcement').enforceTenant(tenant._id)
        .catch((e) => console.error('Billing enforce error:', e.message));
    return { invoice };
}

async function createInvoice(tenant, period, platform, now = new Date()) {
    const r = await buildInvoice(tenant, period, platform, now);
    return r.invoice || null;
}

// period "2026-09" (must be a finished month). tenantId is optional (leave out to do every shop).
async function generateForPeriod({ period, tenantId } = {}) {
    const now = new Date();
    const p = period || previousPeriod(now);
    if (!PERIOD_RE.test(p)) throw Object.assign(new Error('period must look like 2026-10'), { status: 400 });
    if (p >= periodOf(now)) throw Object.assign(new Error('You can only create an invoice for a month that has finished'), { status: 400 });

    const tenants = await Tenant.find(tenantId ? { _id: tenantId } : {})
        .select('slug name phone address business subscription createdAt billing').lean();
    const platform = await PlatformSettings.findById('main').lean();

    let created = 0;
    const skipped = {};   // why some shops got no invoice, e.g. { in_free_service: 2 }
    for (const t of tenants) {
        try {
            const r = await buildInvoice(t, p, platform, now);
            if (r.invoice) created += 1;
            else skipped[r.skip] = (skipped[r.skip] || 0) + 1;
        } catch (e) {
            console.error(`Billing: could not invoice ${t.slug}:`, e.message);
            skipped.error = (skipped.error || 0) + 1;
        }
    }
    return { period: p, created, checked: tenants.length, skipped };
}

// Runs a little after the server starts and then every 6 hours. It always works on the month that just finished,
// so the invoices appear on the 1st by themselves. Safe if two servers run it at the same time.
function startBillingScheduler() {
    const run = () => generateForPeriod()
        .then((r) => { if (r.created) console.log(`Billing: created ${r.created} invoice(s) for ${r.period}`); })
        .catch((e) => console.error('Billing scheduler error:', e.message));
    setTimeout(run, 20 * 1000).unref?.();
    setInterval(run, 6 * 60 * 60 * 1000).unref?.();
}

// adds "overdue" (a pending invoice past its due date) for the panel
const withOverdue = (inv, now = new Date()) => ({
    ...inv,
    overdue: inv.status === 'pending' && new Date(inv.dueDate) < now,
});

module.exports = {
    PERIOD_RE, periodOf, nextPeriod, previousPeriod, periodStart, financialYear, firstBillablePeriod, monthLabel,
    syncFreeState, createInvoice, generateForPeriod, startBillingScheduler, withOverdue,
};