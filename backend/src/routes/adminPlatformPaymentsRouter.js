// Superadmin: YOUR Razorpay account, which receives SMS top-ups and monthly rent. Mounted under /api/admin.
//   GET  /platform/payments                  status and checklist (never a secret)
//   PUT  /platform/payments/keys             { keyId, keySecret }  write only
//   POST /platform/payments/webhook-secret   makes a new webhook secret, shown ONCE
//   POST /platform/payments/test             test the connection with Razorpay
// Keys saved here win over RAZORPAY_* in .env. The webhook address is /api/webhooks/razorpay/platform.
const publicBase = require('../utils/publicBase');
const express = require('express');
const crypto = require('crypto');
const PlatformSettings = require('../models/PlatformSettings');
const { wrap, httpError } = require('../middlewares/apiErrors');
const secretBox = require('../utils/secretBox');
const payments = require('../services/adapters/payments');
const platformPayments = require('../services/platformPayments');

const router = express.Router();
const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
const baseUrl = publicBase;   // PUBLIC_BASE_URL locally, the real address in production (utils/publicBase.js)
const status = (req) => platformPayments.status(baseUrl(req));
const setPayments = (update) => PlatformSettings.collection.updateOne({ _id: 'main' }, update, { upsert: true });

router.get('/platform/payments', wrap(async (req, res) => {
    res.json(await status(req));
}));

router.put('/platform/payments/keys', wrap(async (req, res) => {
    const body = req.body || {};
    const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
    const keySecret = typeof body.keySecret === 'string' ? body.keySecret.trim() : '';
    if (req.body) delete req.body.keySecret;   // the audit log must never see the secret, even when the request fails

    if (!KEY_ID_RE.test(keyId)) throw httpError(400, 'Key ID must look like rzp_test_xxxx or rzp_live_xxxx');
    if (keySecret.length < 10 || keySecret.length > 80) throw httpError(400, 'The key secret is missing or too short');

    await setPayments({
        $set: { 'payments.keyId': keyId, 'payments.keySecretEnc': secretBox.encrypt(keySecret) },
        $unset: { 'payments.verifiedAt': 1, 'payments.lastWebhookAt': 1 },   // new keys must be tested again
    });
    await platformPayments.load();
    await require('../services/operators').syncActiveFromLive().catch((e) => console.error('Company sync error:', e.message));
    res.json(await status(req));
}));

router.post('/platform/payments/webhook-secret', wrap(async (req, res) => {
    const secret = crypto.randomBytes(18).toString('base64url');   // 24 characters
    await setPayments({
        $set: { 'payments.webhookSecretEnc': secretBox.encrypt(secret) },
        $unset: { 'payments.lastWebhookAt': 1 },
    });
    await platformPayments.load();
    await require('../services/operators').syncActiveFromLive().catch((e) => console.error('Company sync error:', e.message));
    const s = await status(req);
    res.json({
        webhookUrl: s.webhookUrl,
        secret,
        events: s.events,
        disputeEvents: s.disputeEvents,
        note: 'The secret is shown only once. Paste the URL and the secret into YOUR Razorpay dashboard (Settings, Webhooks). Webhooks fail until the new secret is pasted there.',
    });
}));

router.post('/platform/payments/test', wrap(async (req, res) => {
    const creds = payments.platformCredentials();
    if (!payments.isMock() && !creds) throw httpError(400, 'Save the keys first');
    try {
        await payments.ping({ credentials: creds });
    } catch (e) {
        if (e.status === 401 || e.status === 403) throw httpError(400, 'Razorpay rejected these keys. Check the Key ID and the Key Secret.');
        console.error('Platform payments test error:', e.message);
        throw httpError(502, 'Could not reach Razorpay. Try again.');
    }
    await setPayments({ $set: { 'payments.verifiedAt': new Date() } });
    res.json({ ok: true, ...(await status(req)) });
}));

module.exports = router;
