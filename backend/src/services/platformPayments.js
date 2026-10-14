// YOUR OWN Razorpay account (the platform account): it receives SMS top-ups and monthly rent.
// The keys are saved here (secrets encrypted) from the superadmin app, and win over RAZORPAY_* in .env.
// The payment code reads the keys synchronously (payments.platformCredentials), so this file keeps them in
// memory and refreshes every minute, which also makes a second server instance follow a change.
const PlatformSettings = require('../models/PlatformSettings');
const secretBox = require('../utils/secretBox');
const payments = require('./adapters/payments');

const keyMode = (keyId) => (/^rzp_live_/.test(keyId || '') ? 'live' : /^rzp_test_/.test(keyId || '') ? 'test' : null);

// below Mongoose, so select:false does not hide the encrypted fields
async function raw() {
    const doc = await PlatformSettings.collection.findOne({ _id: 'main' }, { projection: { payments: 1 } });
    return doc?.payments || null;
}

const open = (box, what) => {
    if (!box) return null;
    try { return secretBox.decrypt(box); } catch (e) {
        console.error(`Platform payments: could not read the ${what}:`, e.message);
        return null;
    }
};

// saved keys -> the payment adapter (null = fall back to .env)
async function load() {
    const p = (await raw()) || {};
    const keyId = p.keyId || null;
    const keySecret = open(p.keySecretEnc, 'key secret');
    const webhookSecret = open(p.webhookSecretEnc, 'webhook secret');
    if (keyId && keySecret) {
        payments.setPlatformOverride({ keyId, keySecret, webhookSecret: webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || null });
    } else if (webhookSecret) {
        // only a webhook secret saved: keys still come from .env
        payments.setPlatformOverride(null, webhookSecret);
    } else {
        payments.setPlatformOverride(null);
    }
}

let timer = null;
function start() {
    load().catch((e) => console.error('Platform payments load failed:', e.message));
    if (!timer) {
        timer = setInterval(() => load().catch(() => { }), 60 * 1000);
        timer.unref?.();
    }
}

// what the superadmin app shows. Never any secret.
async function status(base) {
    const p = (await raw()) || {};
    const saved = !!(p.keyId && p.keySecretEnc);
    const env = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
    const keyId = saved ? p.keyId : (env ? process.env.RAZORPAY_KEY_ID : null);
    const hasWebhookSecret = !!(p.webhookSecretEnc || process.env.RAZORPAY_WEBHOOK_SECRET);
    const mock = payments.isMock();
    const mode = keyMode(keyId);
    const warnings = [];
    if (mock) warnings.push('Mock payments are on for the whole server: no real money moves.');
    if (mode === 'test') warnings.push('These are TEST keys: no real money moves.');
    if (keyId && !hasWebhookSecret) warnings.push('No webhook secret yet: paid bills and top-ups will not be marked paid by themselves.');
    if (keyId && !p.lastWebhookAt) warnings.push('No webhook event has been received yet.');
    return {
        mockMode: mock,
        source: saved ? 'saved' : env ? 'env' : 'none',   // where the keys come from
        keyId,
        keyMode: mode,
        hasKeySecret: saved || env,
        hasWebhookSecret,
        verifiedAt: p.verifiedAt || null,
        lastWebhookAt: p.lastWebhookAt || null,
        webhookUrl: `${base}/api/webhooks/razorpay/platform`,
        events: ['payment.captured', 'payment.failed', 'refund.processed', 'refund.failed', 'qr_code.credited'],
        disputeEvents: ['payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required', 'payment.dispute.won', 'payment.dispute.lost', 'payment.dispute.closed'],
        checklist: [
            { step: 'keys_saved', done: saved || env },
            { step: 'connection_tested', done: !!p.verifiedAt },
            { step: 'webhook_secret_created', done: hasWebhookSecret },
            { step: 'webhook_event_received', done: !!p.lastWebhookAt },
        ],
        warnings,
    };
}

module.exports = { raw, load, start, status, keyMode };
