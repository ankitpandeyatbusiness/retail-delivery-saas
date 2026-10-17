// Late fee on rent that is not paid. A monthly bill that stays unpaid past its due date earns a fee for every full
// "overdue month" (lateFeeEveryDays, 30 by default): lateFeePercent (5) % of that bill's amount, plus GST at the bill's rate.
//
//   - each fee is its OWN invoice (kind "custom" with `lateFee` filled), numbered like every other bill, with GST and a line
//     that says exactly what it is for. It never pauses the shop on its own (no grace date).
//   - one fee per bill per overdue month (unique index), so running this job again, or on two servers, adds nothing.
//   - the fee grows without compounding: it is always on the bill's own amount, never on earlier fees.
//   - a bill that is paid stops earning fees; fees already issued stay to be paid. If the bill is cancelled or waived
//     by the superadmin, its unpaid fees are cancelled with it (each with its credit note).
//   - at most MAX_MONTHS fees per bill.
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const invoicing = require('./platformInvoicing');
const creditNotes = require('./creditNotes');
const { monthLabel } = require('./subscriptionService');

const DAY_MS = 86400000;
const MAX_MONTHS = 12;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

const rulesOf = (platform) => ({
    percent: platform?.billing?.lateFeePercent ?? 5,
    everyDays: platform?.billing?.lateFeeEveryDays ?? 30,
});

// the fee for overdue month `k` (1, 2, 3 ...) of one unpaid monthly bill. Returns the invoice, or null when it exists already.
async function issueOne({ inv, k, platform, tenant, now }) {
    const { percent, everyDays } = rulesOf(platform);
    if (await SubscriptionInvoice.exists({ 'lateFee.forInvoiceId': inv._id, 'lateFee.month': k })) return null;

    const b = platform.business || {};
    const base = round2((inv.baseAmount * percent) / 100);
    if (!(base > 0)) return null;
    const gstPercent = b.gstin ? (inv.gstPercent || 0) : 0;
    const gstAmount = round2((base * gstPercent) / 100);
    const from = new Date(new Date(inv.dueDate).getTime() + (k - 1) * everyDays * DAY_MS);
    const to = new Date(new Date(inv.dueDate).getTime() + k * everyDays * DAY_MS);
    const what = inv.period ? `${monthLabel(inv.period)} bill ${inv.invoiceNo}` : `bill ${inv.invoiceNo}`;
    const description = `Late fee, ${what}: unpaid after its due date ${day(inv.dueDate)}. Overdue month ${k} (${day(from)} to ${day(to)}): ${percent}% of Rs ${inv.baseAmount}`;

    const num = await invoicing.allocate('SUB', { now });
    const { seller, buyer } = invoicing.parties(b, tenant);
    const tax = invoicing.taxFor({ seller, buyer, gstAmount });
    try {
        return await SubscriptionInvoice.create({
            tenantId: inv.tenantId,
            kind: 'custom',
            invoiceNo: num.invoiceNo,
            issueDate: now,
            dueDate: now,                 // a late fee is due at once
            notifiedAt: now,              // the overdue reminders tell the owner; no separate "new bill" message
            description: `Late fee for ${what} (overdue month ${k})`,
            lineItems: [{ description, qty: 1, rate: base, amount: base }],
            baseAmount: base,
            gstPercent,
            gstAmount,
            total: round2(base + gstAmount),
            markedBy: 'system',
            lateFee: { forInvoiceId: inv._id, forInvoiceNo: inv.invoiceNo, month: k, percent, onAmount: inv.baseAmount, fromDate: from, toDate: to },
            ...tax,
            seller,
            buyer,
        });
    } catch (e) {
        await num.undo();   // keep invoice numbers continuous
        if (e.code === 11000) return null;   // another server made it a moment ago
        throw e;
    }
}

// all fees that have come due for every unpaid monthly bill
async function run(now = new Date()) {
    const platform = await PlatformSettings.findById('main').lean();
    const { percent, everyDays } = rulesOf(platform);
    if (!(percent > 0) || !platform?.business?.legalName) return { issued: 0 };

    const late = await SubscriptionInvoice.find({
        status: 'pending',
        kind: { $ne: 'custom' },
        dueDate: { $lte: new Date(now.getTime() - everyDays * DAY_MS) },
    }).sort({ dueDate: 1 }).limit(300).lean();

    const tenants = new Map();
    let issued = 0;
    for (const inv of late) {
        const months = Math.min(MAX_MONTHS, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (everyDays * DAY_MS)));
        const key = String(inv.tenantId);
        if (!tenants.has(key)) tenants.set(key, await Tenant.findById(inv.tenantId).select('name phone address business subscription').lean());
        const tenant = tenants.get(key);
        if (!tenant) continue;
        for (let k = 1; k <= months; k += 1) {
            try {
                if (await issueOne({ inv, k, platform, tenant, now })) issued += 1;
            } catch (e) { console.error('Late fee error:', e.message); }
        }
    }
    return { issued };
}

// the bill was cancelled or waived: its unpaid late fees go with it
async function voidFor(inv, { reason, by } = {}) {
    const kids = await SubscriptionInvoice.find({ 'lateFee.forInvoiceId': inv._id, status: 'pending' }).lean();
    let n = 0;
    for (const kid of kids) {
        const voided = await SubscriptionInvoice.findOneAndUpdate(
            { _id: kid._id, status: 'pending' },
            { $set: { status: 'void', voidedAt: new Date(), voidReason: reason || 'The bill was cancelled', markedBy: by || 'system' } },
            { returnDocument: 'after' },
        ).lean();
        if (!voided) continue;
        await creditNotes.issueFor(voided, { reason: voided.voidReason, by });
        n += 1;
    }
    return n;
}

module.exports = { run, voidFor, issueOne, rulesOf, MAX_MONTHS };
