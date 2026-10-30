// Handles one Razorpay webhook. Returns { status, body }. Rules:
//  - the signature is checked on the RAW body with the secret of that shop (or the platform)
//  - every event id is processed once; a failed event answers 500 so Razorpay sends it again
const crypto = require('crypto');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const SmsTopup = require('../models/SmsTopup');
const OnlinePayment = require('../models/OnlinePayment');
const Evt = require('../models/PaymentWebhookEvent');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const paymentService = require('./paymentService');
const refundIssuer = require('./refundIssuer');
const smsTopupService = require('./smsTopupService');
const rentPayments = require('./rentPaymentService');
const auditTrail = require('../middlewares/auditTrail');
const alert = require('./paymentAlerts');
const disputeService = require('./disputeService');

const reply = (status, body) => ({ status, body });

async function claim(account, eventId, event) {
    try {
        return { ev: await Evt.create({ account, eventId, event, status: 'processing', attempts: 1 }) };
    } catch (e) {
        if (e.code !== 11000) throw e;
    }
    const stale = new Date(Date.now() - 2 * 60 * 1000);
    const ev = await Evt.findOneAndUpdate(
        { account, eventId, $or: [{ status: 'failed' }, { status: 'processing', updatedAt: { $lt: stale } }] },
        { $set: { status: 'processing' }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
    );
    if (ev) return { ev };
    const cur = await Evt.findOne({ account, eventId });
    return cur?.status === 'done' ? { done: true } : { busy: true };
}

async function onPayment(account, body, name) {
    const rzp = paymentService.fromEntity(body.payload?.payment?.entity);
    if (account === 'platform') return name === 'payment.captured' ? require('./platformCheckout').onPlatformPayment(rzp) : { ignored: 'platform_payment' };
    if (!rzp.orderId) return { ignored: 'no_order' };   // e.g. a QR payment
    const payment = await OnlinePayment.findOne({ tenantId: account, rzpOrderId: rzp.orderId });
    if (!payment) return (name !== 'payment.failed' && (await require('./tablePayment').onWebhook({ account, rzp }) || await require('./owedPayment').onWebhook({ account, rzp }) || await require('./bookingPayment').onWebhook({ account, rzp }))) || { ignored: 'unknown_order' };   // or the online payment of an unpaid table bill
    if (name === 'payment.failed') {
        return paymentService.markFailed({ payment, reason: body.payload?.payment?.entity?.error_description });
    }
    return paymentService.confirmCapture({ payment, rzp, source: 'webhook' });
}

// SMS top-up QR paid (platform account only)
async function onQrCredited(account, body) {
    const qr = body.payload?.qr_code?.entity || {};
    const pay = paymentService.fromEntity(body.payload?.payment?.entity);
    if (account !== 'platform') return require('./doorPayment').credit({ account, qr, pay });   // a customer paid a Cash on delivery order by QR at the door
    if (qr.notes?.purpose === 'rent') return rentPayments.onCredited({ qr, pay });
    if (qr.notes?.purpose !== 'sms_topup') return { ignored: 'other_purpose' };
    const topupId = qr.notes.referenceId;
    const topup = mongoose.isValidObjectId(topupId) ? await SmsTopup.findById(topupId) : null;
    const problem = !topup ? 'Top-up not found'
        : (topup.qrId && topup.qrId !== qr.id) ? 'QR does not match the top-up'
            : pay.status !== 'captured' ? 'Payment is not captured'
                : pay.amountPaise !== smsTopupService.payable(topup) ? 'Amount does not match the top-up' : null;
    if (problem) {
        await alert('admin_webhook_failed', { vars: { event: 'qr_code.credited', error: `${problem} (payment ${pay.id}). Check Razorpay and credit by hand if it is real.` } });
        return { ignored: 'check_failed' };
    }
    const done = await smsTopupService.complete({ topupId, paymentId: pay.id, actor: { type: 'system' } });
    if (!done.duplicate) {   // a webhook has no logged-in person, so the audit row is written here
        await auditTrail.record({
            actorType: 'system',
            actorLabel: 'razorpay',
            tenantId: topup.tenantId,
            action: 'SMS_TOPUP_PAID_ONLINE',
            method: 'WEBHOOK',
            path: '/api/webhooks/razorpay/platform',
            status: 200,
            params: { topupId: String(topup._id), amountPaise: topup.amountPaise, paymentId: pay.id, qrId: qr.id },
        });
    }
    return { topup: 'credited' };
}

async function route(account, body) {
    const name = String(body.event || '');
    switch (name) {
        case 'payment.captured':
        case 'payment.failed':
            return onPayment(account, body, name);
        case 'refund.processed':
        case 'refund.failed':
            return refundIssuer.onRefundEvent({ account, name, entity: body.payload?.refund?.entity || {} });
        case 'qr_code.credited':
            return onQrCredited(account, body);
        case 'payment.dispute.created':
        case 'payment.dispute.under_review':
        case 'payment.dispute.action_required':
        case 'payment.dispute.won':
        case 'payment.dispute.lost':
        case 'payment.dispute.closed':
            return disputeService.onDisputeEvent({ account, name, entity: body.payload?.dispute?.entity || {} });
        default:
            return { ignored: name };   // disputes and the rest come later
    }
}

async function handle({ account, rawBody, signature, eventIdHeader }) {
    const isPlatform = account === 'platform';
    let secret = null;
    if (isPlatform) {
        secret = payments.platformCredentials()?.webhookSecret || null;
    } else {
        if (!mongoose.isValidObjectId(account) || !(await Tenant.exists({ _id: account }))) return reply(404, { error: 'Not found' });
        secret = (await accounts.forTenant(account)).webhookSecret;
    }
    if (!payments.verifyWebhook({ rawBody, signature, secret })) return reply(401, { error: 'Bad signature' });

    if (!isPlatform) await Tenant.updateOne({ _id: account }, { $set: { 'payments.lastWebhookAt': new Date() } });
    else await require('../models/PlatformSettings').collection.updateOne({ _id: 'main' }, { $set: { 'payments.lastWebhookAt': new Date() } }, { upsert: true });

    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch (e) { return reply(400, { error: 'Bad body' }); }
    const name = String(body.event || '');
    const eventId = eventIdHeader || `h:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;

    const c = await claim(account, eventId, name);
    if (c.done) return reply(200, { ok: true, duplicate: true });
    if (c.busy) return reply(500, { error: 'Still processing, try again' });

    try {
        const result = await route(account, body);
        await Evt.updateOne({ _id: c.ev._id }, { $set: { status: 'done' }, $unset: { error: 1 } });
        return reply(200, { ok: true, ...result });
    } catch (e) {
        console.error(`Webhook ${name} failed:`, e.message);
        await Evt.updateOne({ _id: c.ev._id }, { $set: { status: 'failed', error: String(e.message).slice(0, 300) } }).catch(() => { });
        if (c.ev.attempts <= 1 || c.ev.attempts % 5 === 0) {
            await alert('admin_webhook_failed', { tenantId: isPlatform ? undefined : account, vars: { event: name, error: e.message } });
        }
        return reply(500, { error: 'Could not process, try again' });
    }
}

module.exports = { handle };