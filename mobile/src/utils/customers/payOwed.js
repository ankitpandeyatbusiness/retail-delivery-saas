// Pays online the bill a customer left unpaid at a table (the shop's own Razorpay keys), with the UPI app he picks.
//   1. POST /dinein/owed/pay        -> the server makes the Razorpay order for exactly what he owes
//   2. Razorpay.open(intent flow)   -> Android shows its UPI app chooser, he pays, we are brought back
//   3. POST /dinein/owed/pay/verify -> the server checks the proof and asks Razorpay; only then is the bill cleared
// Resolves { status: 'paid' | 'cancelled' | 'failed' | 'pending', message? }. Never throws.
import Razorpay from 'react-native-customui';
import { startOwedPayment, verifyOwedPayment, checkOwedPayment, fetchTableBill } from '../../api/customers/shopApi';

const PAYMENT_CANCELED = 2;   // Razorpay error code
const FALLBACK_EMAIL = 'orders@retailsaas.app';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (e, fallback) => e?.response?.data?.error || e?.description || e?.message || fallback;
const tenDigits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const isCancel = (e) => e?.code === PAYMENT_CANCELED || /cancel/i.test(e?.description || '');

// the bill may have been cleared by a webhook while we were away
const clearedNow = async () => { try { return !(await fetchTableBill())?.owed; } catch (e) { return false; } };

// asks the server, which asks RAZORPAY itself, a few times whether the money arrived
async function settled() {
    for (let i = 0; i < 5; i += 1) {
        try { if ((await checkOwedPayment())?.paid) return true; } catch (e) { if (await clearedNow()) return true; }
        await wait(1500);
    }
    return false;
}

export async function payOwed({ user }) {
    let start;
    try { start = await startOwedPayment(); } catch (e) { return { status: 'failed', message: text(e, 'Could not start the payment') }; }
    Razorpay.initRazorpay(start.keyId);   // the promise it returns never settles, so it is not awaited
    const options = {
        key_id: start.keyId, order_id: start.rzpOrderId, amount: String(start.amountPaise), currency: start.currency || 'INR',
        description: 'Unpaid table bill', email: user?.email || FALLBACK_EMAIL, contact: tenDigits(user?.phone),
        method: 'upi', '_[flow]': 'intent',
    };
    let proof;
    try {
        proof = await Razorpay.open(options);
    } catch (e) {
        if (await clearedNow()) return { status: 'paid' };   // some apps report "cancelled" after the money was taken
        if (isCancel(e)) return { status: 'cancelled', message: 'Payment cancelled' };
        return { status: 'failed', message: text(e, 'Payment failed') };
    }
    const hasProof = proof?.razorpay_order_id && proof?.razorpay_payment_id && proof?.razorpay_signature;
    if (!hasProof) return (await settled()) ? { status: 'paid' } : { status: 'cancelled', message: 'Payment not completed' };
    for (let i = 0; i < 3; i += 1) {
        try {
            const r = await verifyOwedPayment({ razorpay_order_id: proof.razorpay_order_id, razorpay_payment_id: proof.razorpay_payment_id, razorpay_signature: proof.razorpay_signature });
            if (r.paid) return { status: 'paid' };
            return (await settled()) ? { status: 'paid' } : { status: 'failed', message: 'Payment was not completed' };
        } catch (e) {
            if (e?.response && e.response.status < 500) return (await settled()) ? { status: 'paid' } : { status: 'failed', message: 'The payment could not be confirmed' };
            await wait(1500 * (i + 1));   // network or server trouble: the money may already be taken, so try again
        }
    }
    if (await clearedNow()) return { status: 'paid' };
    return { status: 'pending', message: 'We are confirming your payment. Your bill will clear shortly.' };
}
