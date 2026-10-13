// Switches ON online payments for ONE shop using the Razorpay keys from .env (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).
// For development and for shops that use your own account. A shop with its own Razorpay account should instead have its
// keys saved from the superadmin panel (PUT /api/admin/tenants/:tid/payments/keys).
//   node src/scripts/enableShopPayments.js <shop slug or id>
// Does the same steps as the superadmin routes: save keys (encrypted), test the connection, create a webhook secret, enable.
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const Tenant = require('../models/Tenant');
const secretBox = require('../utils/secretBox');
const payments = require('../services/adapters/payments');

const fail = async (msg) => {
    console.error(msg);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
};

(async () => {
    const ref = (process.argv[2] || '').trim();
    if (!ref) return fail('Usage: node src/scripts/enableShopPayments.js <shop slug or id>');

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/.test(keyId || '') || !keySecret) {
        return fail('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing or invalid in .env');
    }
    if (payments.isMock()) return fail('PAYMENTS_MOCK is true in .env. Set it to false to use real Razorpay.');

    // fails early (before any change) when SECRETS_KEY is missing, duplicated with a wrong value, or not 32 bytes
    try { secretBox.decrypt(secretBox.encrypt('check')); } catch (e) { return fail(`SECRETS_KEY problem: ${e.message}. Fix it in .env first.`); }

    await connectDB();
    const isId = mongoose.isValidObjectId(ref);
    const shop = await Tenant.findOne(isId ? { $or: [{ _id: ref }, { slug: ref }] } : { slug: ref }).select('_id name slug').lean();
    if (!shop) return fail(`No shop found for "${ref}"`);

    try {
        await payments.ping({ credentials: { keyId, keySecret } });
    } catch (e) {
        return fail(e.status === 401 || e.status === 403
            ? 'Razorpay rejected the keys in .env. Check the Key ID and Key Secret.'
            : `Could not reach Razorpay: ${e.message}`);
    }

    const webhookSecret = crypto.randomBytes(18).toString('base64url');
    await Tenant.updateOne({ _id: shop._id }, {
        $set: {
            'payments.keyId': keyId,
            'payments.keySecretEnc': secretBox.encrypt(keySecret),
            'payments.webhookSecretEnc': secretBox.encrypt(webhookSecret),
            'payments.verifiedAt': new Date(),
            'payments.enabled': true,
        },
        $unset: { 'payments.lastWebhookAt': 1 },
    });

    const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
    console.log(`Online payments are ON for "${shop.name}" (${shop.slug}) using ${keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST'} keys.`);
    console.log('\nTo let Razorpay confirm payments by webhook as well, add this in Razorpay -> Settings -> Webhooks:');
    console.log(`  URL:    ${base}/api/webhooks/razorpay/${shop._id}   (must be a public https address)`);
    console.log(`  Secret: ${webhookSecret}   (shown only now)`);
    console.log('  Events: payment.captured, payment.failed, refund.processed, refund.failed');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
