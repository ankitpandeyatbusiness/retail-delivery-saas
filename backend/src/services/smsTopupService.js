// SMS top-up: make a QR, and credit the wallet when it is paid.
const SmsTopup = require('../models/SmsTopup');
const PlatformSettings = require('../models/PlatformSettings');
const payments = require('./adapters/payments');
const wallet = require('./smsWalletService');
const notify = require('./notificationService');
const Tenant = require('../models/Tenant');
const invoicing = require('./platformInvoicing');

const MAX_PENDING = 5;
const bad = (status, message) => Object.assign(new Error(message), { status });

async function options() {
    const p = await PlatformSettings.findById('main').select('sms business.gstin').lean();
    return {
        packs: p?.sms?.packs ?? [10000, 25000, 50000],
        minPaise: p?.sms?.minTopupPaise ?? 10000,
        maxPaise: p?.sms?.maxTopupPaise ?? 1000000,
        // added ON TOP of the amount the owner types, but ONLY while the platform business has a GST number saved:
        // charging GST without being registered is not allowed (same rule as the rent invoice)
        gstPercent: p?.business?.gstin ? (p?.sms?.gstPercent ?? 18) : 0,
    };
}

// the owner types what he wants in his balance; GST is added on top and he pays the total
function price(amountPaise, gstPercent) {
    const gstPaise = Math.round((amountPaise * gstPercent) / 100);
    return { amountPaise, gstPercent, gstPaise, payablePaise: amountPaise + gstPaise };
}
const payable = (t) => (Number.isInteger(t.payablePaise) ? t.payablePaise : t.amountPaise);

// a pending top-up whose QR time is over is shown as expired
const view = (t, now = new Date()) => ({
    ...t,
    status: t.status === 'pending' && t.expiresAt && new Date(t.expiresAt) < now ? 'expired' : t.status,
});

async function create({ tenantId, amountPaise, actor }) {
    const o = await options();
    if (!Number.isInteger(amountPaise) || amountPaise < o.minPaise || amountPaise > o.maxPaise) {
        throw bad(400, `Amount must be between ${o.minPaise} and ${o.maxPaise} paise`);
    }
    const open = await SmsTopup.countDocuments({ tenantId, status: 'pending', expiresAt: { $gt: new Date() } });
    if (open >= MAX_PENDING) throw bad(429, 'Too many open top-ups. Pay one or wait a few minutes.');

    const cost = price(amountPaise, o.gstPercent);
    const topup = new SmsTopup({ tenantId, ...cost, createdBy: actor });
    let qr;
    try {
        qr = await payments.createQr({ amountPaise: cost.payablePaise, purpose: 'sms_topup', referenceId: String(topup._id) });
    } catch (e) {
        console.error('Top-up QR error:', e.message);
        throw bad(503, 'Top-up is not available yet. Contact support.');   // superadmin manual credit still works
    }
    Object.assign(topup, { qrId: qr.qrId, upiString: qr.upiString, imageUrl: qr.imageUrl, expiresAt: qr.expiresAt });
    await topup.save();
    return topup.toObject();
}

// Called by the Razorpay webhook (Phase 4) or by the superadmin (mark paid by hand). Safe to call twice.
// The wallet credit uses one fixed key per top-up, so it can never be added twice.
async function complete({ topupId, tenantId, paymentId, actor }) {
    const t = await SmsTopup.findById(topupId);
    if (!t || (tenantId && String(t.tenantId) !== String(tenantId))) throw bad(404, 'Top-up not found');
    if (t.status === 'paid') return { ok: true, duplicate: true };

    // a late payment (QR already expired) is still real money, so it is still credited
    const r = await wallet.credit({
        tenantId: t.tenantId, amountPaise: t.amountPaise, type: 'topup',
        paymentId: `topup:${t._id}`, note: 'SMS top-up', actor,
    });
    await SmsTopup.updateOne(
        { _id: t._id, status: { $ne: 'paid' } },
        { $set: { status: 'paid', paidAt: new Date(), paymentId: paymentId || undefined, paidBy: actor } },
    );
    await ensureInvoice(t._id).catch((e) => console.error('Top-up invoice error:', e.message));   // the tax invoice / receipt
    require('./settlement').recordTopupPaid(await SmsTopup.findById(t._id).lean()).catch((e) => console.error('Settlement row error:', e.message));   // a row on the common sheet
    if (!r.duplicate) {   // tell the owner once: in the app, and a receipt by email
        notify.toOwner(t.tenantId, {
            type: 'sms_topup_done', title: 'SMS balance added',
            body: `Rs ${(t.amountPaise / 100).toFixed(2)} added to your SMS balance.`,
            data: { topupId: String(t._id), amountPaise: t.amountPaise, gstPaise: t.gstPaise || 0, gstPercent: t.gstPercent || 0, payablePaise: payable(t), balanceAfter: r.balanceAfter },
        });
    }
    return r;
}

// The tax invoice / receipt of a PAID top-up. Made once (the number is taken only if it is saved). When the platform business
// has no name saved yet nothing is made; the next call (the PDF route, the receipt mail) makes it.
async function ensureInvoice(topupId) {
    const t = await SmsTopup.findById(topupId).lean();
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
        invoiceNo: num.invoiceNo, kind: 'sms_topup', issueDate, status: 'paid', paidAt: issueDate,
        paymentMode: t.paidBy?.type === 'superadmin' ? 'other' : 'online', paymentRef: t.paymentId || undefined,
        description: 'SMS balance top-up',
        lineItems: [{ description: 'SMS balance top-up (prepaid, used for SMS sent from your shop)', qty: 1, rate: baseAmount, amount: baseAmount }],
        baseAmount, gstPercent: t.gstPercent || 0, gstAmount, total: payable(t) / 100, reverseCharge: false, ...tax, seller, buyer,
    };
    const r = await SmsTopup.updateOne({ _id: t._id, 'invoice.invoiceNo': { $exists: false } }, { $set: { invoice } });
    if (!r.modifiedCount) { await num.undo(); return (await SmsTopup.findById(t._id).select('invoice').lean())?.invoice || null; }
    return invoice;
}

module.exports = { options, view, price, payable, create, complete, ensureInvoice };