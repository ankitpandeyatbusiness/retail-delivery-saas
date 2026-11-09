// Partner wallet top-up: options and prices, and crediting the wallet once the money is captured. Same shape as smsTopupService.js.
// The wallet gets exactly what the owner chose; GST is added ON TOP (only while the platform business has a GST number), so Rs 500 + 18% = Rs 590 paid, Rs 500 in the wallet.
// The per-order fee has no GST of its own. The payment itself runs through services/platformCheckout.js (startPartnerTopup / verifyPartnerTopup).
const PartnerTopup = require('../models/PartnerTopup');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const wallet = require('./partnerWalletService');
const planService = require('./planService');
const invoicing = require('./platformInvoicing');

const bad = (status, message) => Object.assign(new Error(message), { status });

async function options() {
    const [d, p] = await Promise.all([planService.getDefaults(), PlatformSettings.findById('main').select('business.gstin').lean()]);
    return { packs: d.packsPaise, minPaise: d.minTopupPaise, maxPaise: d.maxTopupPaise, gstPercent: p?.business?.gstin ? d.gstPercent : 0 };
}

function price(amountPaise, gstPercent) {
    const gstPaise = Math.round((amountPaise * gstPercent) / 100);
    return { amountPaise, gstPercent, gstPaise, payablePaise: amountPaise + gstPaise };
}
const payable = (t) => (Number.isInteger(t.payablePaise) ? t.payablePaise : t.amountPaise);

// Called once Razorpay says captured (app verify or webhook). Safe to call twice: the wallet credit has one fixed key per top-up.
async function complete({ topupId, tenantId, paymentId, actor }) {
    const t = await PartnerTopup.findById(topupId);
    if (!t || (tenantId && String(t.tenantId) !== String(tenantId))) throw bad(404, 'Top-up not found');
    if (t.status === 'paid') return { ok: true, duplicate: true };
    const r = await wallet.credit({ tenantId: t.tenantId, amountPaise: t.amountPaise, type: 'topup', paymentId: `ptopup:${t._id}`, note: 'Wallet top-up', actor });
    await PartnerTopup.updateOne({ _id: t._id, status: { $ne: 'paid' } }, { $set: { status: 'paid', paidAt: new Date(), paymentId: paymentId || undefined, paidBy: actor } });
    await ensureInvoice(t._id).catch((e) => console.error('Wallet top-up invoice error:', e.message));
    return r;
}

// The tax invoice of a PAID top-up, made once (the number is taken only if it is saved). Nothing is made while the platform business has no name saved yet.
async function ensureInvoice(topupId) {
    const t = await PartnerTopup.findById(topupId).lean();
    if (!t || t.status !== 'paid') return null;
    if (t.invoice && t.invoice.invoiceNo) return t.invoice;
    const platform = await PlatformSettings.findById('main').select('business').lean();
    if (!platform?.business?.legalName) return null;
    const tenant = await Tenant.findById(t.tenantId).select('name phone address business').lean();
    if (!tenant) return null;
    const issueDate = t.paidAt || new Date();
    const num = await invoicing.allocate('TOP', { now: issueDate });
    const { seller, buyer } = invoicing.parties(platform.business, tenant);
    const baseAmount = t.amountPaise / 100;
    const gstAmount = (t.gstPaise || 0) / 100;
    const tax = invoicing.taxFor({ seller, buyer, gstAmount });
    const invoice = {
        invoiceNo: num.invoiceNo, kind: 'wallet_topup', issueDate, status: 'paid', paidAt: issueDate,
        paymentMode: t.paidBy?.type === 'superadmin' ? 'other' : 'online', paymentRef: t.paymentId || undefined,
        description: 'Wallet top-up',
        lineItems: [{ description: 'Wallet top-up (prepaid, used for the per-order fee of your Partner plan)', qty: 1, rate: baseAmount, amount: baseAmount }],
        baseAmount, gstPercent: t.gstPercent || 0, gstAmount, total: payable(t) / 100, reverseCharge: false, ...tax, seller, buyer,
    };
    const r = await PartnerTopup.updateOne({ _id: t._id, 'invoice.invoiceNo': { $exists: false } }, { $set: { invoice } });
    if (!r.modifiedCount) { await num.undo(); return (await PartnerTopup.findById(t._id).select('invoice').lean())?.invoice || null; }
    return invoice;
}

module.exports = { options, price, payable, complete, ensureInvoice };
