// The supreme admin's bulk money actions on a brand: the same actions he has on one bill, for the branches he chooses (or all of them) in one go.
//   waiveLateFees   every unpaid late fee of the chosen branches (the rent bills stay)
//   markPaid        every unpaid bill of the chosen branches (rent and late fees), paid by hand (UPI, bank ...) with ONE payment mode, receiver and note
//   markUnpaid      the paid rent bills of one month go back to unpaid
// Each returns one row per branch: what was done and what was skipped, with the reason. Nothing here is a new rule: a bill that is void is never touched,
// and a bill that was paid ONLINE is never turned back to unpaid by hand (real money was captured: it is a refund, not an undo).
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Tenant = require('../models/Tenant');
const lateFees = require('./lateFees');
const { withOverdue, PERIOD_RE } = require('./subscriptionService');
const { enforceTenant } = require('./billingEnforcement');
const { httpError } = require('../middlewares/apiErrors');

const MODES = SubscriptionInvoice.schema.path('paymentMode').enumValues;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

// 'all' (or nothing) = every branch of the brand; else the chosen branches, all of which must belong to the brand
async function branchesOf(brand, which) {
    const all = await Tenant.find({ brandId: brand._id }).sort({ createdAt: 1, _id: 1 }).select('slug name').lean();
    if (which === undefined || which === null || which === 'all') return all;
    if (!Array.isArray(which) || !which.length) throw httpError(400, 'Choose the branches, or all');
    const wanted = new Set(which.map(String));
    const chosen = all.filter((b) => wanted.has(String(b._id)));
    if (chosen.length !== wanted.size) throw httpError(404, 'A chosen branch is not part of this brand');
    return chosen;
}

const rowOf = (b) => ({ slug: b.slug, name: b.name, done: 0, amount: 0, skipped: [] });
const totalsOf = (rows) => ({
    done: rows.reduce((s, r) => s + r.done, 0), amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
    skipped: rows.reduce((s, r) => s + r.skipped.length, 0), branches: rows.length,
});

async function waiveLateFees(brand, which, { reason, by }) {
    const text = clean(reason, 200);
    if (!text) throw httpError(400, 'Write a reason');
    const rows = [];
    for (const b of await branchesOf(brand, which)) {
        const row = rowOf(b);
        const r = await lateFees.waiveAllFor(b._id, { reason: text, by });
        row.done = r.waived;
        row.amount = r.amount;
        if (r.waived) require('./shopSettingsNotice').lateFeesWaived(b._id);
        rows.push(row);
    }
    return { rows, totals: totalsOf(rows) };
}

async function markPaid(brand, which, body, admin) {
    const mode = body.paymentMode;
    if (mode !== undefined && !MODES.includes(mode)) throw httpError(400, `paymentMode must be one of: ${MODES.join(', ')}`);
    if (!['owner', 'partner'].includes(body.receivedBy)) throw httpError(400, 'receivedBy must be "owner" or "partner" (who got the money)');
    const set = { status: 'paid', paidAt: new Date(), markedBy: admin.email, receivedBy: body.receivedBy };
    if (mode) set.paymentMode = mode;
    const ref = clean(body.paymentRef, 60);
    if (ref) set.paymentRef = ref;
    const note = clean(body.note, 200);
    if (note) set.note = note;

    const rows = [];
    for (const b of await branchesOf(brand, which)) {
        const row = rowOf(b);
        const pending = await SubscriptionInvoice.find({ tenantId: b._id, status: 'pending' }).sort({ issueDate: 1, _id: 1 }).lean();
        for (const inv of pending) {
            // only a bill that is still pending changes (a payment that arrived a moment ago is left alone)
            const done = await SubscriptionInvoice.findOneAndUpdate({ _id: inv._id, status: 'pending' }, { $set: set }, { returnDocument: 'after' }).lean();
            if (!done) { row.skipped.push({ invoiceNo: inv.invoiceNo, reason: 'It was paid a moment ago' }); continue; }
            row.done += 1;
            row.amount = round2(row.amount + done.total);
        }
        await enforceTenant(b._id);   // paid unpauses the branch at once
        rows.push(row);
    }
    return { rows, totals: totalsOf(rows) };
}

async function markUnpaid(brand, which, body, admin) {
    if (!PERIOD_RE.test(String(body.period || ''))) throw httpError(400, 'period must look like 2026-10');
    const rows = [];
    for (const b of await branchesOf(brand, which)) {
        const row = rowOf(b);
        const paid = await SubscriptionInvoice.find({ tenantId: b._id, status: 'paid', kind: 'monthly', period: body.period }).lean();
        for (const inv of paid) {
            if (inv.markedBy === 'razorpay') { row.skipped.push({ invoiceNo: inv.invoiceNo, reason: 'Paid online: the money was really taken, so this is a refund, not an undo' }); continue; }
            const undone = await SubscriptionInvoice.findOneAndUpdate(
                { _id: inv._id, status: 'paid' },
                { $set: { status: 'pending', markedBy: admin.email }, $unset: { paidAt: 1, paymentMode: 1, paymentRef: 1 } },
                { returnDocument: 'after' },
            ).lean();
            if (!undone) continue;
            row.done += 1;
            row.amount = round2(row.amount + undone.total);
        }
        await enforceTenant(b._id);   // an unpaid bill can pause the branch again
        rows.push(row);
    }
    return { rows, totals: totalsOf(rows) };
}

module.exports = { waiveLateFees, markPaid, markUnpaid, branchesOf, withOverdue };
