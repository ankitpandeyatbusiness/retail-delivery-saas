// Monthly app-rent invoices (you -> each shop).
// Creating them is safe to repeat: a shop can never get two invoices for the same month.

const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const Counter = require('../models/Counter');

const IST_OFFSET_MS = 330 * 60 * 1000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// "2026-10" for a date, in Indian time
function periodOf(date) {
    const d = new Date(date.getTime() + IST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

// Creates the invoice for one shop and one month. Returns null if nothing needed creating.
async function createInvoice(tenant, period, platform, now = new Date()) {
    const sub = tenant.subscription || {};
    const fee = Number(sub.monthlyFee) || 0;
    if (!(fee > 0)) return null;                                      // this shop is not billed

    // FIX 1: Prevent billing for past months. Default to the month the shop was created.
    const shopStartMonth = periodOf(tenant.createdAt || new Date());
    if (period < (sub.startMonth || shopStartMonth)) return null;       // billing has not started yet

    if (await SubscriptionInvoice.exists({ tenantId: tenant._id, period })) return null;

    const b = platform?.business || {};

    // FIX 2: Prevent blank invoices. Wait until you've filled out your platform details.
    if (!b.legalName) return null;

    // FIX 3: Stop illegal tax. Only charge the 18% GST if the platform actually has a GSTIN.
    const gstPercent = b.gstin ? (sub.gstPercent ?? 18) : 0;
    const gstAmount = round2((fee * gstPercent) / 100);
    const total = round2(fee + gstAmount);

    const fy = financialYear(period);
    const counter = await Counter.findOneAndUpdate({ _id: `subinv:${fy}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    const invoiceNo = `SUB/${fy}/${String(counter.seq).padStart(4, '0')}`;

    // current month: issued today; an older month being filled in: dated the 1st of that month
    const issueDate = period === periodOf(now) ? now : periodStart(period);
    const dueDays = platform?.billing?.dueDays ?? 7;
    const dueDate = new Date(issueDate.getTime() + dueDays * 24 * 60 * 60 * 1000);

    const biz = tenant.business || {};
    const addr = tenant.address || {};
    try {
        return await SubscriptionInvoice.create({
            tenantId: tenant._id,
            period,
            invoiceNo,
            issueDate,
            dueDate,
            description: `App subscription for ${monthLabel(period)}`,
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
        if (e.code === 11000) return null;   // someone else created it a moment ago
        throw e;
    }
}

// period "2026-10". tenantId is optional (leave out to do every billed shop).
async function generateForPeriod({ period, tenantId } = {}) {
    const p = period || periodOf(new Date());
    if (!PERIOD_RE.test(p)) throw Object.assign(new Error('period must look like 2026-10'), { status: 400 });

    const filter = { 'subscription.monthlyFee': { $gt: 0 } };
    if (tenantId) filter._id = tenantId;
    const tenants = await Tenant.find(filter).select('name phone address business subscription').lean();
    const platform = await PlatformSettings.findById('main').lean();

    let created = 0;
    for (const t of tenants) {
        if (await createInvoice(t, p, platform)) created += 1;
    }
    return { period: p, created, checked: tenants.length };
}

// Runs a few seconds after the server starts and then every 6 hours, so each month's invoices
// appear by themselves. (It is safe if two servers run it at the same time.)
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
    PERIOD_RE, periodOf, financialYear, monthLabel, createInvoice, generateForPeriod, startBillingScheduler, withOverdue,
};