// SMS top-up: make a QR, and credit the wallet when it is paid.
const SmsTopup = require('../models/SmsTopup');
const PlatformSettings = require('../models/PlatformSettings');
const payments = require('./adapters/payments');
const wallet = require('./smsWalletService');

const MAX_PENDING = 5;
const bad = (status, message) => Object.assign(new Error(message), { status });

async function options() {
    const p = await PlatformSettings.findById('main').select('sms').lean();
    return {
        packs: p?.sms?.packs ?? [10000, 25000, 50000],
        minPaise: p?.sms?.minTopupPaise ?? 10000,
        maxPaise: p?.sms?.maxTopupPaise ?? 1000000,
    };
}

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

    const topup = new SmsTopup({ tenantId, amountPaise, createdBy: actor });
    const qr = await payments.createQr({ amountPaise, purpose: 'sms_topup', referenceId: String(topup._id) });
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
    return r;
}

module.exports = { options, view, create, complete };