// Superadmin: online payments of one shop. Mounted under /api/admin, so login and the audit log already ran.
//   GET  /tenants/:tid/payments                  status and checklist (never a secret)
//   PUT  /tenants/:tid/payments/keys             { keyId, keySecret }  write only
//   POST /tenants/:tid/payments/webhook-secret   makes a new webhook secret, shown ONCE
//   POST /tenants/:tid/payments/test             test connection with Razorpay
//   PUT  /tenants/:tid/payments/enabled          { enabled: true|false }
const publicBase = require('../utils/publicBase');
const express = require('express');
const crypto = require('crypto');
const Tenant = require('../models/Tenant');
const loadTenant = require('../middlewares/loadTenant');
const { wrap, httpError } = require('../middlewares/apiErrors');
const secretBox = require('../utils/secretBox');
const payments = require('../services/adapters/payments');
const accounts = require('../services/paymentAccounts');
const paymentGuard = require('../services/paymentGuard');

const router = express.Router();
const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
const baseUrl = publicBase;   // PUBLIC_BASE_URL locally, the real address in production (utils/publicBase.js)
const status = (req) => accounts.statusFor(req.tenantDoc._id, baseUrl(req));

router.get('/tenants/:tid/payments', loadTenant, wrap(async (req, res) => {
    res.json(await status(req));
}));

router.put('/tenants/:tid/payments/keys', loadTenant, wrap(async (req, res) => {
    const body = req.body || {};
    const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
    const keySecret = typeof body.keySecret === 'string' ? body.keySecret.trim() : '';
    if (req.body) delete req.body.keySecret;   // the audit log must never see the secret, even when the request fails

    if (!KEY_ID_RE.test(keyId)) throw httpError(400, 'Key ID must look like rzp_test_xxxx or rzp_live_xxxx');
    if (keySecret.length < 10 || keySecret.length > 80) throw httpError(400, 'The key secret is missing or too short');

    const p = await accounts.rawPayments(req.tenantDoc._id);
    if (p?.enabled) throw httpError(409, 'Switch online payments off before changing the keys');
    if (body.acknowledgeOpenMoney !== true) {
        const open = await paymentGuard.openMoney(req.tenantDoc._id);
        if (open) throw httpError(409, `${open} Wait until it is finished, or send acknowledgeOpenMoney: true if you are sure.`);
    }

    await Tenant.updateOne({ _id: req.tenantDoc._id }, {
        $set: { 'payments.keyId': keyId, 'payments.keySecretEnc': secretBox.encrypt(keySecret), 'payments.enabled': false },
        $unset: { 'payments.verifiedAt': 1, 'payments.lastWebhookAt': 1 },   // new keys must be tested again
    });
    res.json(await status(req));
}));

router.post('/tenants/:tid/payments/webhook-secret', loadTenant, wrap(async (req, res) => {
    const secret = crypto.randomBytes(18).toString('base64url');   // 24 characters
    await Tenant.updateOne({ _id: req.tenantDoc._id }, {
        $set: { 'payments.webhookSecretEnc': secretBox.encrypt(secret) },
        $unset: { 'payments.lastWebhookAt': 1 },
    });
    res.json({
        webhookUrl: `${baseUrl(req)}/api/webhooks/razorpay/${req.tenantDoc._id}`,
        secret,
        events: ['payment.captured', 'payment.failed', 'refund.processed', 'refund.failed'],
        disputeEvents: ['payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required', 'payment.dispute.won', 'payment.dispute.lost', 'payment.dispute.closed'],
        note: 'The secret is shown only once. Paste the URL and the secret into the shop\'s Razorpay dashboard (Settings, Webhooks). If payments are already on, webhooks fail until the new secret is pasted there.',
    });
}));

router.post('/tenants/:tid/payments/test', loadTenant, wrap(async (req, res) => {
    const creds = await accounts.forTenant(req.tenantDoc._id);
    if (!payments.isMock() && !(creds.keyId && creds.keySecret)) throw httpError(400, 'Save the keys first');
    try {
        await payments.ping({ credentials: creds });
    } catch (e) {
        if (e.status === 401 || e.status === 403) throw httpError(400, 'Razorpay rejected these keys. Check the Key ID and the Key Secret.');
        console.error('Payments test error:', e.message);
        throw httpError(502, 'Could not reach Razorpay. Try again.');
    }
    await Tenant.updateOne({ _id: req.tenantDoc._id }, { $set: { 'payments.verifiedAt': new Date() } });
    res.json({ ok: true, ...(await status(req)) });
}));

router.put('/tenants/:tid/payments/enabled', loadTenant, wrap(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') throw httpError(400, 'Send enabled: true or false');
    if (req.body.enabled) {
        const p = await accounts.rawPayments(req.tenantDoc._id);
        if (!p?.keyId || !p?.keySecretEnc) throw httpError(409, 'Save the keys first');
        if (!p.verifiedAt) throw httpError(409, 'Test the connection first');
        if (!p.webhookSecretEnc) throw httpError(409, 'Create the webhook secret first');
    }
    await Tenant.updateOne({ _id: req.tenantDoc._id }, { $set: { 'payments.enabled': req.body.enabled } });
    res.json(await status(req));
}));

module.exports = router;