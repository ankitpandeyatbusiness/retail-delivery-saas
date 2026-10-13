// Pays one online (UPI) order with Razorpay's Custom UI SDK, opening the chosen UPI app directly.
//   1. POST /orders/:id/pay        -> the server makes the Razorpay order with THIS shop's keys
//   2. Razorpay.open(intent flow)  -> the chosen UPI app (upiApp.pkg) opens, the customer pays, we are brought back
//   3. POST /orders/:id/pay/verify -> the server checks the proof and asks Razorpay; only then is the order paid
// Resolves to { status: 'paid' | 'cancelled' | 'failed' | 'pending', order?, message? }. Never throws.
import Razorpay from 'react-native-customui';
import { startOrderPayment, verifyOrderPayment, fetchOrder } from '../api/shopApi';
import { defaultUpiApp, rememberUpiApp } from './upiApps';

const PAYMENT_CANCELED = 2;   // Razorpay error code
const FALLBACK_EMAIL = 'orders@retailsaas.app';   // Razorpay needs an email; customers here log in by phone
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (e, fallback) => e?.response?.data?.error || e?.description || e?.message || fallback;
const isPaid = (o) => o?.payment?.status === 'paid';
const tenDigits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// the order may have been paid by a webhook while we were away
async function paidNow(id) {
    try {
        const o = await fetchOrder(id);
        return isPaid(o) ? o : null;
    } catch (e) { return null; }
}

async function verify(id, proof) {
    let last;
    for (let i = 0; i < 3; i += 1) {
        try {
            return await verifyOrderPayment(id, proof);
        } catch (e) {
            last = e;
            if (e?.response && e.response.status < 500) break;   // the server said no: do not repeat
            await wait(1500 * (i + 1));                          // network or server trouble: money may already be taken, so try again
        }
    }
    throw last;
}

export async function payForOrder({ order, user, upiApp }) {
    const id = order._id || order.id;

    const app = upiApp?.pkg ? upiApp : await defaultUpiApp();
    if (!app) return { status: 'failed', message: 'No UPI app found on this phone' };

    let start;
    try {
        start = await startOrderPayment(id);
    } catch (e) {
        if (e?.response?.status === 409) {   // already paid, or no longer payable
            const o = await paidNow(id);
            if (o) return { status: 'paid', order: o };
        }
        return { status: 'failed', message: text(e, 'Could not start the payment') };
    }

    rememberUpiApp(app.pkg);
    Razorpay.initRazorpay(start.keyId);   // the promise it returns never settles, so it is not awaited

    let proof;
    try {
        proof = await Razorpay.open({
            key_id: start.keyId,
            order_id: start.rzpOrderId,
            amount: String(start.amountPaise),
            currency: start.currency || 'INR',
            description: order.orderNo ? `Order #${order.orderNo}` : 'Order payment',
            email: user?.email || FALLBACK_EMAIL,
            contact: tenDigits(user?.phone),
            method: 'upi',
            upi_app_package_name: app.pkg,
            '_[flow]': 'intent',
        });
    } catch (e) {
        if (e?.code === PAYMENT_CANCELED || /cancel/i.test(e?.description || '')) return { status: 'cancelled', message: 'Payment cancelled' };
        const o = await paidNow(id);   // some apps report an error after the money was taken
        if (o) return { status: 'paid', order: o };
        return { status: 'failed', message: text(e, 'Payment failed') };
    }

    try {
        const r = await verify(id, {
            razorpay_order_id: proof.razorpay_order_id,
            razorpay_payment_id: proof.razorpay_payment_id,
            razorpay_signature: proof.razorpay_signature,
        });
        if (r.paid) return { status: 'paid', order: r.order };
    } catch (e) { /* fall through: check the order once more */ }

    const o = await paidNow(id);
    if (o) return { status: 'paid', order: o };
    return { status: 'pending', message: 'We are confirming your payment. It will show on your order shortly.' };
}
