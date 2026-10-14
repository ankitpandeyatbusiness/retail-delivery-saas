// Pays one online (UPI) order with Razorpay's Custom UI SDK, opening the chosen UPI app directly.
//   1. POST /orders/:id/pay        -> the server makes the Razorpay order with THIS shop's keys
//   2. Razorpay.open(intent flow)  -> the chosen UPI app (upiApp.pkg) opens, the customer pays, we are brought back
//   3. POST /orders/:id/pay/verify -> the server checks the proof and asks Razorpay; only then is the order paid
// Resolves to { status: 'paid' | 'cancelled' | 'failed' | 'pending', order?, message? }. Never throws.
import Razorpay from 'react-native-customui';
import { startOrderPayment, verifyOrderPayment, fetchOrder, fetchPaymentConfig, cancelOrder, checkOrderPayment } from '../api/shopApi';
import { defaultUpiApp, rememberUpiApp, detectInstalledUpiApps } from './upiApps';

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

// The customer backed out of the payment (or it failed): the order was never paid, so it is withdrawn, like
// Zomato / Blinkit do: he goes back to his cart and nothing was ordered.
// -> { paid: true, order } if the money turned out to have arrived after all, otherwise { paid: false }. Never throws.
export async function abandonUnpaidOrder(id) {
    try {
        const o = await paidNow(id);          // some apps report "cancelled" after the money was taken
        if (o) return { paid: true, order: o };
        await cancelOrder(id, 'Payment not completed');
    } catch (e) {
        const o = await paidNow(id);          // cancel refused because a payment landed in between
        if (o) return { paid: true, order: o };
        // otherwise the order stays unpaid: the shop never sees it, and it is cleaned up by the server
    }
    return { paid: false };
}

// Gets everything ready BEFORE the customer taps pay, so the tap goes straight to the UPI app:
// the payment SDK is started with the shop's public key, and the installed UPI apps are looked up once.
// Safe to call many times; never throws.
let warmKey = null;
let warmAt = 0;
export async function prewarmPayments(known) {   // known: a payment-config answer the caller already has
    try {
        detectInstalledUpiApps().catch(() => { });
        if (warmKey && Date.now() - warmAt < 10 * 60 * 1000) return;
        const c = known || await fetchPaymentConfig();
        if (c?.online && c.keyId) {
            Razorpay.initRazorpay(c.keyId);
            warmKey = c.keyId;
            warmAt = Date.now();
        }
    } catch (e) { /* the normal path still works */ }
}

// Asks the server, which asks RAZORPAY itself, a few times whether the money arrived. It does not wait for a
// webhook, so a payment that was really taken is never mistaken for a cancelled one.
async function settled(id) {
    for (let i = 0; i < 5; i += 1) {
        try {
            const r = await checkOrderPayment(id);
            if (r?.paid && r.order) return r.order;
        } catch (e) {
            const o = await paidNow(id);   // the check itself failed: at least look at our own record
            if (o) return o;
        }
        await wait(1500);
    }
    return null;
}

const isCancel = (e) => e?.code === PAYMENT_CANCELED || /cancel/i.test(e?.description || '');

// Pays one online order.
//   upiApp: { pkg } the UPI app to open.        card: { number, month, year, cvv, name } to pay by card.
// Resolves { status: 'paid' | 'cancelled' | 'failed' | 'pending', order?, message? }. Never throws.
//   cancelled / failed = nothing was paid (the caller takes the customer back to the cart)
//   pending            = we could not find out (network): the order is kept and shown
export async function payForOrder({ order, user, upiApp, card }) {
    const id = order._id || order.id;
    const isCard = !!card;

    let app = null;
    if (!isCard) {
        if (upiApp?.chooser) app = { pkg: null, label: upiApp.label };   // "any UPI app": Android shows its own chooser
        else app = upiApp?.pkg ? upiApp : await defaultUpiApp();
        if (!app) return { status: 'failed', message: 'No UPI app found on this phone' };
    }

    // the order answer already carried the payment details (one round trip fewer); otherwise ask the server
    let start = order.paymentStart || null;
    try {
        if (!start) start = await startOrderPayment(id);
    } catch (e) {
        if (e?.response?.status === 409) {   // already paid, or no longer payable
            const o = await paidNow(id);
            if (o) return { status: 'paid', order: o };
        }
        return { status: 'failed', message: text(e, 'Could not start the payment') };
    }

    if (app?.pkg) rememberUpiApp(app.pkg);
    if (warmKey !== start.keyId) {
        Razorpay.initRazorpay(start.keyId);   // the promise it returns never settles, so it is not awaited
        warmKey = start.keyId;
        warmAt = Date.now();
    }

    const common = {
        key_id: start.keyId,
        order_id: start.rzpOrderId,
        amount: String(start.amountPaise),
        currency: start.currency || 'INR',
        description: order.orderNo ? `Order #${order.orderNo}` : 'Order payment',
        email: user?.email || FALLBACK_EMAIL,
        contact: tenDigits(user?.phone),
    };
    const options = isCard
        ? {
            ...common,
            method: 'card',
            'card[name]': card.name || user?.name || 'Customer',
            'card[number]': String(card.number).replace(/\s/g, ''),
            'card[expiry_month]': String(card.month).padStart(2, '0'),
            'card[expiry_year]': String(card.year).slice(-2),
            'card[cvv]': String(card.cvv),
        }
        : { ...common, method: 'upi', ...(app.pkg ? { upi_app_package_name: app.pkg } : {}), '_[flow]': 'intent' };

    let proof;
    const t0 = Date.now();
    try {
        proof = await Razorpay.open(options);
    } catch (e) {
        if (__DEV__) console.warn('[pay] Razorpay.open failed', JSON.stringify(e));
        if (isCancel(e)) {
            const o = await paidNow(id);   // some apps report "cancelled" after the money was taken
            return o ? { status: 'paid', order: o } : { status: 'cancelled', message: 'Payment cancelled' };
        }
        // the chosen UPI app refused to start (some apps do not accept a direct launch): try once more and let
        // Android show its own app chooser instead of failing
        if (!isCard && app.pkg && Date.now() - t0 < 5000) {
            try {
                const { upi_app_package_name: _drop, ...open } = options;
                proof = await Razorpay.open(open);
            } catch (e2) {
                if (__DEV__) console.warn('[pay] retry without app failed', JSON.stringify(e2));
                if (isCancel(e2)) return { status: 'cancelled', message: 'Payment cancelled' };
                const o2 = await paidNow(id);
                if (o2) return { status: 'paid', order: o2 };
                return { status: 'failed', message: text(e2, 'This UPI app could not start the payment. Try another app.') };
            }
        } else {
            const o = await paidNow(id);
            if (o) return { status: 'paid', order: o };
            return { status: 'failed', message: text(e, 'Payment failed') };
        }
    }

    // Some apps (CRED...) report "success" even when the customer backed out: there is no payment proof then.
    // Only a real payment id + signature counts; otherwise ask the server, and if it was not paid it was cancelled.
    const hasProof = proof?.razorpay_order_id && proof?.razorpay_payment_id && proof?.razorpay_signature;
    if (!hasProof) {
        const o = await settled(id);
        return o ? { status: 'paid', order: o } : { status: 'cancelled', message: 'Payment not completed' };
    }

    try {
        const r = await verify(id, {
            razorpay_order_id: proof.razorpay_order_id,
            razorpay_payment_id: proof.razorpay_payment_id,
            razorpay_signature: proof.razorpay_signature,
        });
        if (r.paid) return { status: 'paid', order: r.order };
        // the server asked Razorpay and the money is NOT captured (CRED "try again", a declined payment...).
        // Give a late capture a few seconds, then it is a failed payment: back to the cart, never "placed".
        const late = await settled(id);
        return late ? { status: 'paid', order: late } : { status: 'failed', message: 'Payment was not completed' };
    } catch (e) {
        if (e?.response && e.response.status < 500) {   // the server looked and said "not paid / bad proof"
            const o = await settled(id);
            return o ? { status: 'paid', order: o } : { status: 'failed', message: 'The payment could not be confirmed' };
        }
        /* network or server trouble: fall through, the money may have been taken */
    }

    const o = await paidNow(id);
    if (o) return { status: 'paid', order: o };
    return { status: 'pending', message: 'We are confirming your payment. It will show on your order shortly.' };
}
