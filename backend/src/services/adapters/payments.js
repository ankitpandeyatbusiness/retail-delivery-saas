// Payments adapter. Business code calls ONLY this file, never Razorpay directly.
// Money here is always integer PAISE (Rs 1 = 100 paise).
//
// PAYMENTS_MOCK=true -> fake QR and fake results (development)
// otherwise          -> real Razorpay (Phase 4, not connected yet)
//
// Every function throws on failure.

if (
    process.env.PAYMENTS_MOCK === 'true' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PAYMENTS_MOCK_IN_PROD !== 'true'
) {
    throw new Error('FATAL: PAYMENTS_MOCK must not be enabled in production.');
}

const mockProvider = {
    // QR for an SMS top-up or a rent payment. `credentials` is null for the platform account.
    async createQr({ amountPaise, purpose, referenceId }) {
        return {
            qrId: `mock_qr_${referenceId}`,
            upiString: `upi://pay?pa=mock@upi&am=${(amountPaise / 100).toFixed(2)}&tn=${purpose}`,
            imageUrl: null,
            expiresAt: new Date(Date.now() + 15 * 60000),
        };
    },
    // In mock mode every signature is accepted (blocked in production by the check above)
    verifyWebhook() {
        return true;
    },
    async refund({ paymentId, amountPaise }) {
        return { refundId: `mock_refund_${paymentId}`, amountPaise };
    },
};

const realProvider = {
    async createQr() {
        // PHASE 4: create the Razorpay QR here (platform keys for SMS top-up and rent,
        // or the shop's own keys for customer orders)
        throw new Error('Payments provider not configured');
    },
    // Razorpay signs the raw body with HMAC-SHA256 using the webhook secret and sends it in a header.
    // Check the current Razorpay docs before relying on this.
    verifyWebhook({ rawBody, signature, secret }) {
        const crypto = require('crypto');
        if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const a = Buffer.from(expected);
        const b = Buffer.from(String(signature));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    async refund() {
        throw new Error('Payments provider not configured');
    },
    // PHASE 4: instant settlement. Read the Razorpay docs first. Do not hard-code fees.
};

const provider = () => (process.env.PAYMENTS_MOCK === 'true' ? mockProvider : realProvider);

module.exports = {
    createQr: (args) => provider().createQr(args),
    verifyWebhook: (args) => provider().verifyWebhook(args),
    refund: (args) => provider().refund(args),
};