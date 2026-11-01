// Whose Razorpay keys to use. The platform keys live in .env; each shop's keys live (encrypted) in the database.
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const secretBox = require('../utils/secretBox');
const payments = require('./adapters/payments');

const toId = (v) => new mongoose.Types.ObjectId(String(v));
const keyMode = (keyId) => (/^rzp_live_/.test(keyId || '') ? 'live' : /^rzp_test_/.test(keyId || '') ? 'test' : null);

// The raw stored block, including the encrypted fields (read below Mongoose, so select:false does not get in the way)
async function rawPayments(tenantId) {
    const doc = await Tenant.collection.findOne({ _id: toId(tenantId) }, { projection: { payments: 1 } });
    return doc?.payments || null;
}

const open = (box, what) => {
    if (!box) return null;
    try { return secretBox.decrypt(box); } catch (e) {
        console.error(`Payments: could not read the ${what}:`, e.message);
        return null;
    }
};

async function forTenant(tenantId) {
    const p = (await rawPayments(tenantId)) || {};
    return {
        enabled: !!p.enabled,
        keyId: p.keyId || null,
        keySecret: open(p.keySecretEnc, 'key secret'),
        webhookSecret: open(p.webhookSecretEnc, 'webhook secret'),
        verifiedAt: p.verifiedAt || null,
        lastWebhookAt: p.lastWebhookAt || null,
        mode: keyMode(p.keyId),
    };
}

const readable = (box) => { try { secretBox.decrypt(box); return true; } catch (e) { return false; } };

// Shops whose saved key secret cannot be decrypted (SECRETS_KEY lost or changed). Their payments would silently stop.
async function unreadableKeys() {
    const rows = await Tenant.collection.find({ 'payments.keySecretEnc': { $exists: true } }, { projection: { name: 1, 'payments.keySecretEnc': 1, 'payments.webhookSecretEnc': 1 } }).toArray();
    return rows.filter((t) => !readable(t.payments.keySecretEnc) || (t.payments.webhookSecretEnc && !readable(t.payments.webhookSecretEnc))).map((t) => ({ id: String(t._id), name: t.name }));
}

// Run once at startup: tell the superadmin loudly instead of finding out from a customer
async function checkKeysReadable() {
    if (payments.isMock()) return [];
    const bad = await unreadableKeys();
    if (bad.length) {
        const names = bad.slice(0, 5).map((b) => b.name || b.id).join(', ');
        console.error(`PAYMENTS: the saved Razorpay keys of ${bad.length} shop(s) cannot be read. Is SECRETS_KEY the same as before? (${names})`);
        await require('./paymentAlerts')('admin_webhook_failed', { vars: { event: 'startup check', error: `The saved Razorpay keys of ${bad.length} shop(s) cannot be read (${names}). SECRETS_KEY is probably missing or changed. Put the old SECRETS_KEY back, or save the keys again.` } });
    }
    return bad;
}

// account = 'platform' or a shop id
async function credentialsFor(account) {
    if (account === 'platform') return payments.platformCredentials();
    return forTenant(account);
}

// May this shop start a NEW online payment right now?
async function canTakePayments(tenantId) {
    if (payments.isMock()) return { ok: true, mock: true };
    const p = await rawPayments(tenantId);
    if (!p?.enabled) return { ok: false, reason: 'Online payments are not switched on for this shop' };
    if (!p.keyId || !p.keySecretEnc) return { ok: false, reason: 'The payment keys are missing' };
    if (!p.webhookSecretEnc) return { ok: false, reason: 'The webhook secret is missing' };
    if (!p.verifiedAt) return { ok: false, reason: 'The payment keys were never tested' };
    return { ok: true, mock: false, keyId: p.keyId, keyMode: keyMode(p.keyId) };
}

// What the superadmin panel shows. Never any secret.
async function statusFor(tenantId, base) {
    const p = (await rawPayments(tenantId)) || {};
    const mock = payments.isMock();
    const mode = keyMode(p.keyId);
    const warnings = [];
    if (mock) warnings.push('Mock payments are on for the whole server: no real money moves.');
    if (mode === 'test') warnings.push('These are TEST keys: no real money moves.');
    if (p.enabled && !p.lastWebhookAt) warnings.push('No webhook event has been received yet.');
    if (p.keySecretEnc && !readable(p.keySecretEnc)) warnings.push('The saved key secret cannot be read (SECRETS_KEY changed?). Payments will fail until the old SECRETS_KEY is back or the keys are saved again.');
    if (p.webhookSecretEnc && !readable(p.webhookSecretEnc)) warnings.push('The saved webhook secret cannot be read (SECRETS_KEY changed?). Webhooks will be refused.');
    return {
        mockMode: mock,
        enabled: !!p.enabled,
        keyId: p.keyId || null,
        keyMode: mode,
        hasKeySecret: !!p.keySecretEnc,
        hasWebhookSecret: !!p.webhookSecretEnc,
        verifiedAt: p.verifiedAt || null,
        lastWebhookAt: p.lastWebhookAt || null,
        webhookUrl: `${base}/api/webhooks/razorpay/${tenantId}`,
        checklist: [
            { step: 'keys_saved', done: !!(p.keyId && p.keySecretEnc) },
            { step: 'connection_tested', done: !!p.verifiedAt },
            { step: 'webhook_secret_created', done: !!p.webhookSecretEnc },
            { step: 'webhook_event_received', done: !!p.lastWebhookAt },
            { step: 'enabled', done: !!p.enabled },
        ],
        warnings,
    };
}

module.exports = { keyMode, rawPayments, forTenant, credentialsFor, canTakePayments, statusFor, unreadableKeys, checkKeysReadable };