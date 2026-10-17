// "What do I owe?" for a shop owner: every unpaid bill with its late fees, month by month, and one grand total.
// The same list is what a single "pay all dues" payment settles (platformCheckout.startDues).
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const { monthLabel } = require('./subscriptionService');
const { rulesOf } = require('./lateFees');

const DAY_MS = 86400000;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const feeView = (f) => ({
    id: String(f._id),
    invoiceNo: f.invoiceNo,
    month: f.lateFee.month,                 // overdue month 1, 2, 3 ...
    from: f.lateFee.fromDate,
    to: f.lateFee.toDate,
    percent: f.lateFee.percent,
    onAmount: f.lateFee.onAmount,           // the rent the percentage was taken on
    base: f.baseAmount,
    gstPercent: f.gstPercent,
    gst: f.gstAmount,
    total: f.total,
    description: f.lineItems?.[0]?.description || f.description,
});

async function statement(tenantId, now = new Date()) {
    const [pending, platform] = await Promise.all([
        SubscriptionInvoice.find({ tenantId, status: 'pending' }).sort({ issueDate: 1, _id: 1 }).lean(),
        PlatformSettings.findById('main').select('billing').lean(),
    ]);
    const fees = pending.filter((i) => i.lateFee?.forInvoiceId);
    const bills = pending.filter((i) => !i.lateFee?.forInvoiceId);
    const byBill = new Map();
    for (const f of fees) {
        const k = String(f.lateFee.forInvoiceId);
        if (!byBill.has(k)) byBill.set(k, []);
        byBill.get(k).push(f);
    }
    const billIds = new Set(bills.map((b) => String(b._id)));

    const rows = bills.map((b) => {
        const own = (byBill.get(String(b._id)) || []).sort((x, y) => x.lateFee.month - y.lateFee.month);
        const lateFees = own.map(feeView);
        const feeTotal = round2(own.reduce((s, f) => s + f.total, 0));
        return {
            id: String(b._id),
            invoiceNo: b.invoiceNo,
            kind: b.kind || 'monthly',
            label: b.period ? monthLabel(b.period) : (b.description || 'Bill'),
            issueDate: b.issueDate,
            dueDate: b.dueDate,
            daysOverdue: Math.max(0, Math.floor((now.getTime() - new Date(b.dueDate).getTime()) / DAY_MS)),
            base: b.baseAmount,
            gstPercent: b.gstPercent,
            gst: b.gstAmount,
            total: b.total,
            lateFees,
            lateFeeTotal: feeTotal,
            rowTotal: round2(b.total + feeTotal),
        };
    });
    // a fee whose bill was already paid: it is still owed, so it is listed on its own
    const loose = fees.filter((f) => !billIds.has(String(f.lateFee.forInvoiceId))).map(feeView);

    const rentTotal = round2(bills.reduce((s, b) => s + b.total, 0));
    const lateFeeTotal = round2(fees.reduce((s, f) => s + f.total, 0));
    const { percent, everyDays } = rulesOf(platform);
    return {
        rows,
        looseLateFees: loose,
        rentTotal,
        lateFeeTotal,
        grandTotal: round2(rentTotal + lateFeeTotal),
        count: pending.length,
        invoiceIds: pending.map((i) => String(i._id)),
        rule: {
            percent, everyDays,
            text: percent > 0
                ? `A bill that is unpaid after its due date adds a late fee of ${percent}% of the bill amount (plus GST) for every ${everyDays} days it stays unpaid.`
                : 'There is no late fee.',
        },
    };
}

module.exports = { statement };
