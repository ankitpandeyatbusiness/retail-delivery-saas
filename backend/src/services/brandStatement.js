// The brand's monthly statement: ONE page for the whole brand with a line per branch.
// The legal rent invoices stay one per branch (each has its own number, GST and buyer, and the pause-on-unpaid rule works per branch);
// this statement only adds them up, shows the multi-branch discount, the SMS wallet and roughly how many SMS each branch used. Read only.
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsLog = require('../models/SmsLog');
const wallet = require('./smsWalletService');
const { httpError } = require('../middlewares/apiErrors');

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const startOf = (period) => new Date(`${period}-01T00:00:00+05:30`);
const nextOf = (period) => {
    const [y, m] = period.split('-').map(Number);
    return startOf(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`);
};

async function build(brand, period) {
    if (!PERIOD_RE.test(String(period || ''))) throw httpError(400, 'period must look like 2026-10');
    const branches = await Tenant.find({ brandId: brand._id }).sort({ createdAt: 1, _id: 1 }).select('slug name branchCity address.city').lean();
    const ids = branches.map((b) => b._id);
    const [invoices, sms, walletStatus] = await Promise.all([
        SubscriptionInvoice.find({ tenantId: { $in: ids }, period, kind: 'monthly', status: { $ne: 'void' } })
            .select('tenantId invoiceNo baseAmount gstAmount total status dueDate lineItems orderCount tierLabel paidAt').lean(),
        SmsLog.aggregate([
            { $match: { tenantId: { $in: ids }, createdAt: { $gte: startOf(period), $lt: nextOf(period) }, status: { $ne: 'failed' } } },
            { $group: { _id: '$tenantId', count: { $sum: 1 }, chargedPaise: { $sum: '$chargedPaise' } } },
        ]),
        ids.length ? wallet.status(ids[0]) : null,
    ]);
    const inv = new Map(invoices.map((i) => [String(i.tenantId), i]));
    const used = new Map(sms.map((s) => [String(s._id), s]));

    const rows = branches.map((b, index) => {
        const i = inv.get(String(b._id));
        const discountLine = i && (i.lineItems || []).find((l) => l.amount < 0);
        return {
            slug: b.slug, name: b.name, city: b.branchCity || (b.address && b.address.city) || null, first: index === 0,
            invoice: i ? {
                id: i._id, invoiceNo: i.invoiceNo, orders: i.orderCount, tier: i.tierLabel,
                rent: round2((i.baseAmount || 0) - (discountLine ? discountLine.amount : 0)),   // before the discount
                discount: discountLine ? round2(-discountLine.amount) : 0,
                base: round2(i.baseAmount), gst: round2(i.gstAmount), total: round2(i.total),
                status: i.status, dueDate: i.dueDate, paidAt: i.paidAt || null,
            } : null,
            sms: { count: (used.get(String(b._id)) || {}).count || 0, chargedPaise: (used.get(String(b._id)) || {}).chargedPaise || 0 },   // approximate, for information (the wallet is prepaid)
        };
    });
    const withInvoice = rows.filter((r) => r.invoice);
    const sum = (k) => round2(withInvoice.reduce((s, r) => s + r.invoice[k], 0));
    const totals = {
        invoices: withInvoice.length, rent: sum('rent'), discount: sum('discount'), base: sum('base'), gst: sum('gst'), total: sum('total'),
        unpaid: round2(withInvoice.filter((r) => r.invoice.status === 'pending').reduce((s, r) => s + r.invoice.total, 0)),
        unpaidCount: withInvoice.filter((r) => r.invoice.status === 'pending').length,
        smsCount: rows.reduce((s, r) => s + r.sms.count, 0),
    };
    return {
        brand: { id: brand._id, name: brand.name, discountPercent: brand.discountPercent || 0 },
        period, branches: rows, totals,
        smsWallet: walletStatus && { balancePaise: walletStatus.balancePaise, low: walletStatus.low },   // one wallet for every branch
    };
}

module.exports = { build };
