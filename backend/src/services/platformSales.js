// What the platform sold and was PAID for: plan payments (and extra shops), Partner wallet top-ups, SMS top-ups. Everything is prepaid, so there is nothing "pending":
// a row exists only once the money is captured. The money screens (ledger, GST register, month close, profit and loss, exports, dashboards) all read this one list,
// so their numbers agree. Amounts are RUPEES here (the invoice style), paise in the raw records.
//
//   paid({ from, to, tenantId, tenantIds })  -> [{ id, kind, tenantId, paidAt, issueDate, invoiceNo, description, baseAmount, gstPercent, gstAmount, total, invoice }]
//   kind: 'plan' | 'branch' (an extra shop) | 'wallet' | 'sms'
const PlanPayment = require('../models/PlanPayment');
const PartnerTopup = require('../models/PartnerTopup');
const SmsTopup = require('../models/SmsTopup');
const PartnerTransaction = require('../models/PartnerTransaction');
const PlatformRefund = require('../models/PlatformRefund');

const rs = (paise) => Math.round(paise || 0) / 100;

const fromPlan = (p) => {
    const q = p.quote || {};
    const taxable = rs(q.taxablePaise ?? p.payablePaise);
    const gst = rs(q.gstPaise);
    return {
        id: String(p._id), kind: p.kind === 'branch' ? 'branch' : 'plan', tenantId: p.tenantId, paidAt: p.paidAt, issueDate: p.invoice?.issueDate || p.paidAt,
        invoiceNo: p.invoice?.invoiceNo || null, description: p.kind === 'branch' ? 'Extra shop' : `${String(p.to).replace(/^./, (c) => c.toUpperCase())} plan${p.months ? ` x ${p.months} month${p.months > 1 ? 's' : ''}` : ''}`,
        baseAmount: taxable, gstPercent: q.gstPercent || 0, gstAmount: gst, total: rs(p.payablePaise), invoice: p.invoice || null,
    };
};
const fromTopup = (kind, label) => (t) => ({
    id: String(t._id), kind, tenantId: t.tenantId, paidAt: t.paidAt, issueDate: t.invoice?.issueDate || t.paidAt, invoiceNo: t.invoice?.invoiceNo || null, description: label,
    baseAmount: rs(t.amountPaise), gstPercent: t.gstPercent || 0, gstAmount: rs(t.gstPaise), total: rs(Number.isInteger(t.payablePaise) ? t.payablePaise : t.amountPaise), invoice: t.invoice || null,
});

const fromRefund = (r) => ({
    id: `rf${r._id}`, kind: r.salesKind, tenantId: r.tenantId, paidAt: r.createdAt, issueDate: r.createdAt, invoiceNo: `RF-${String(r._id).slice(-6).toUpperCase()}`,
    description: `Refund: ${r.kind === 'plan' ? 'plan payment' : r.kind === 'wallet' ? 'wallet balance' : 'SMS balance'}`,
    baseAmount: -rs(r.basePaise), gstPercent: r.basePaise ? Math.round((r.gstPaise / r.basePaise) * 100) : 0, gstAmount: -rs(r.gstPaise), total: -rs(r.cashPaise), invoice: null, refund: true,
});

async function paid({ from, to, tenantId, tenantIds } = {}) {
    const when = (field) => (from || to ? { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } } : {});
    const who = tenantId ? { tenantId } : tenantIds ? { tenantId: { $in: tenantIds } } : {};
    const [plans, wallets, sms, refunds] = await Promise.all([
        PlanPayment.find({ status: 'paid', ...when('paidAt'), ...who }).lean(),
        PartnerTopup.find({ status: 'paid', ...when('paidAt'), ...who }).lean(),
        SmsTopup.find({ status: 'paid', ...when('paidAt'), ...who }).lean(),
        PlatformRefund.find({ status: 'processed', counted: true, ...when('createdAt'), ...who }).lean(),   // emergency refunds: money sent back, a negative row on the day it went
    ]);
    return [...plans.map(fromPlan), ...wallets.map(fromTopup('wallet', 'Wallet top-up')), ...sms.map(fromTopup('sms', 'SMS top-up')), ...refunds.map(fromRefund)]
        .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
}

// total paid per India month: { '2026-11': { count, base, gst, total } }
async function byMonth({ from, to } = {}) {
    const out = {};
    for (const r of await paid({ from, to })) {
        const k = new Date(new Date(r.paidAt).getTime() + 330 * 60000).toISOString().slice(0, 7);
        const m = out[k] || (out[k] = { count: 0, base: 0, gst: 0, total: 0 });
        m.count += 1; m.base += r.baseAmount; m.gst += r.gstAmount; m.total += r.total;
    }
    return out;
}

// What ONE shop paid the platform in a period, in rupees: its plan (and extra shops) and the per-order fees taken from its Partner wallet (net of fees put back).
// Wallet top-ups are not a cost: they are prepaid money, the cost is the fees taken out of it.
async function shopCosts({ tenantId, from, to }) {
    const when = from || to ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } } : {};
    const [rows, fees] = await Promise.all([
        paid({ tenantId, from, to }),
        PartnerTransaction.aggregate([{ $match: { tenantId, type: { $in: ['fee', 'reverse'] }, ...when } }, { $group: { _id: null, paise: { $sum: '$amountPaise' } } }]),
    ]);
    const plan = rows.filter((r) => r.kind === 'plan' || r.kind === 'branch').reduce((n, r) => n + r.total, 0);
    return { plan: Math.round(plan * 100) / 100, fees: Math.round(-(fees[0]?.paise || 0)) / 100, sms: Math.round(rows.filter((r) => r.kind === 'sms').reduce((n, r) => n + r.total, 0) * 100) / 100 };
}

module.exports = { paid, byMonth, shopCosts };
