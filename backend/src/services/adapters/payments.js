// Payments adapter. Business code calls ONLY this file, never Razorpay directly.
// Money here is always integer PAISE (Rs 1 = 100 paise).
//
// PAYMENTS_MOCK=true -> fake results (development and tests)
// otherwise          -> real Razorpay
//
// `credentials` = { keyId, keySecret } of the shop. Left out = the PLATFORM account (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).
// Every function throws on failure. The Razorpay request shapes follow their docs: test them with TEST keys first.
const crypto = require('crypto');

if (
    process.env.PAYMENTS_MOCK === 'true' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PAYMENTS_MOCK_IN_PROD !== 'true'
) {
    throw new Error('FATAL: PAYMENTS_MOCK must not be enabled in production.');
}

const API = 'https://api.razorpay.com/v1';
const isMock = () => process.env.PAYMENTS_MOCK === 'true';

// Keys saved from the superadmin app (services/platformPayments.js) win over .env
let platformOverride = null;
let platformWebhookSecret = null;
const setPlatformOverride = (creds, webhookOnly = null) => { platformOverride = creds; platformWebhookSecret = webhookOnly; };

const platformCredentials = () => {
    if (platformOverride) return platformOverride;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = platformWebhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || null;
    return keyId && keySecret ? { keyId, keySecret, webhookSecret } : null;
};

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// The proof the app sends after checkout: HMAC-SHA256 of "orderId|paymentId" with the KEY SECRET of that account
function verifyPaymentSignature({ orderId, paymentId, signature, secret }) {
    if (!orderId || !paymentId || !signature || !secret) return false;
    return safeEqual(hmac(secret, `${orderId}|${paymentId}`), signature);
}

/* ------------------------------ mock ------------------------------ */
const mockState = { payments: new Map(), qrPayments: new Map() };

const mockProvider = {
    async ping() {
        return { ok: true };
    },
    // QR for an SMS top-up or a rent payment
    async createQr({ amountPaise, purpose, referenceId }) {
        return {
            qrId: `mock_qr_${referenceId}`,
            upiString: `upi://pay?pa=mock@upi&am=${(amountPaise / 100).toFixed(2)}&tn=${purpose}`,
            imageUrl: null,
            expiresAt: new Date(Date.now() + 15 * 60000),
        };
    },
    async createOrder({ amountPaise, receipt }) {
        return { id: `order_mock_${receipt}`, amountPaise, status: 'created' };
    },
    async fetchPayment({ paymentId }) {
        const p = mockState.payments.get(paymentId);
        if (!p) throw Object.assign(new Error('Payment not found'), { status: 404 });
        return p;
    },
    // In mock mode every signature is accepted (blocked in production by the check above)
    verifyWebhook() {
        return true;
    },
    async refund({ paymentId, amountPaise }) {
        return { refundId: `mock_refund_${paymentId}_${amountPaise}`, status: 'processed', amountPaise };
    },
    async listOrderPayments({ orderId }) {
        return [...mockState.payments.values()].filter((p) => p.orderId === orderId);
    },
    async listRefunds() {
        return [];
    },
    async closeQr() {
        return { ok: true };
    },
    async listQrPayments({ qrId }) {
        return mockState.qrPayments.get(qrId) || [];
    },
};

/* ------------------------------ real Razorpay ------------------------------ */
async function call(credentials, method, path, body) {
    if (!credentials?.keyId || !credentials?.keySecret) throw new Error('Payments provider not configured');
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`,
            'content-type': 'application/json',
            accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
        const msg = json?.error?.description || `Razorpay error ${res.status}`;
        throw Object.assign(new Error(msg), { status: res.status, code: json?.error?.code, razorpay: true });
    }
    return json;
}

const normalizePayment = (r) => ({
    id: r.id,
    orderId: r.order_id || null,
    status: r.status,                                  // created | authorized | captured | refunded | failed
    amountPaise: r.amount,
    capturedPaise: r.captured ? r.amount : 0,
    refundedPaise: r.amount_refunded || 0,
    method: r.method || null,
    notes: r.notes || {},
});
const normalizeRefund = (r) => ({
    id: r.id, paymentId: r.payment_id, amountPaise: r.amount, status: r.status, receipt: r.receipt || null, notes: r.notes || {},
});

const realProvider = {
    // A harmless call, used by "test connection"
    async ping({ credentials }) {
        await call(credentials, 'GET', '/payments?count=1');
        return { ok: true };
    },
    async createQr({ amountPaise, purpose, referenceId, credentials }) {
        const creds = credentials || platformCredentials();
        const closeBy = Math.floor(Date.now() / 1000) + 15 * 60;
        const r = await call(creds, 'POST', '/payments/qr_codes', {
            type: 'upi_qr',
            name: `${purpose} ${referenceId}`.slice(0, 40),
            usage: 'single_use',
            fixed_amount: true,
            payment_amount: amountPaise,
            description: purpose,
            close_by: closeBy,
            notes: { purpose, referenceId },
        });
        return { qrId: r.id, upiString: null, imageUrl: r.image_url || null, expiresAt: new Date(closeBy * 1000) };
    },
    async createOrder({ amountPaise, receipt, notes, credentials }) {
        const r = await call(credentials || platformCredentials(), 'POST', '/orders', {
            amount: amountPaise, currency: 'INR', receipt, notes: notes || {},
        });
        return { id: r.id, amountPaise: r.amount, status: r.status };
    },
    async fetchPayment({ paymentId, credentials }) {
        return normalizePayment(await call(credentials || platformCredentials(), 'GET', `/payments/${encodeURIComponent(paymentId)}`));
    },
    // Razorpay signs the raw body with HMAC-SHA256 using the webhook secret and sends it in the x-razorpay-signature header.
    verifyWebhook({ rawBody, signature, secret }) {
        if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
        return safeEqual(hmac(secret, rawBody), signature);
    },
    async refund({ paymentId, amountPaise, notes, receipt, credentials, instant }) {
        const r = await call(credentials || platformCredentials(), 'POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
            amount: amountPaise, speed: instant ? 'optimum' : 'normal', notes: notes || {}, receipt,
        });
        return { refundId: r.id, status: r.status, amountPaise: r.amount };
    },
    async listOrderPayments({ orderId, credentials }) {
        const r = await call(credentials || platformCredentials(), 'GET', `/orders/${encodeURIComponent(orderId)}/payments`);
        return (r.items || []).map(normalizePayment);
    },
    async closeQr({ qrId, credentials }) {
        await call(credentials || platformCredentials(), 'POST', `/payments/qr_codes/${encodeURIComponent(qrId)}/close`, {});
        return { ok: true };
    },
    async listQrPayments({ qrId, credentials }) {
        const r = await call(credentials || platformCredentials(), 'GET', `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);
        return (r.items || []).map(normalizePayment);
    },
    async listRefunds({ paymentId, credentials }) {
        const r = await call(credentials || platformCredentials(), 'GET', `/payments/${encodeURIComponent(paymentId)}/refunds`);
        return (r.items || []).map(normalizeRefund);
    },
};

const provider = () => (isMock() ? mockProvider : realProvider);

module.exports = {
    isMock,
    platformCredentials,
    setPlatformOverride,
    verifyPaymentSignature,
    ping: (args) => provider().ping(args),
    createQr: (args) => provider().createQr(args),
    createOrder: (args) => provider().createOrder(args),
    fetchPayment: (args) => provider().fetchPayment(args),
    verifyWebhook: (args) => provider().verifyWebhook(args),
    refund: (args) => provider().refund(args),
    listOrderPayments: (args) => provider().listOrderPayments(args),
    listRefunds: (args) => provider().listRefunds(args),
    closeQr: (args) => provider().closeQr(args),
    listQrPayments: (args) => provider().listQrPayments(args),
    // for tests only
    _mock: { setPayment: (p) => mockState.payments.set(p.id, p), setQrPayments: (qrId, list) => mockState.qrPayments.set(qrId, list), reset: () => { mockState.payments.clear(); mockState.qrPayments.clear(); } },
};