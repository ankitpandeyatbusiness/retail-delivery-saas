// Pays the platform (a rent bill or an SMS top-up) with a UPI app or a card, using Razorpay's Custom UI checkout, the same
// way a customer pays an order (utils/customers/payOnline.js):
//   1. the server makes the Razorpay order (with the platform's keys)  2. the chosen UPI app / card pays it
//   3. the server checks the proof and asks Razorpay itself; only then is the bill or the balance updated.
// Resolves { status: 'paid' | 'cancelled' | 'failed' | 'pending', message? }. Never throws.
import Razorpay from 'react-native-customui';
import { startRentPay, verifyRentPay, startTopupPay, verifyTopupPay, startDuesPay, verifyDuesPay } from '../../api/owners/shopApi';
import { rememberUpiApp } from '../customers/upiApps';

const PAYMENT_CANCELED = 2;   // Razorpay error code
const FALLBACK_EMAIL = 'orders@retailsaas.app';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (e, fallback) => e?.response?.data?.error || e?.description || e?.message || fallback;
const tenDigits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const isCancel = (e) => e?.code === PAYMENT_CANCELED || /cancel/i.test(e?.description || '');

// kind 'rent': id = the bill.   kind 'sms': amountPaise = the top-up.   kind 'dues': every unpaid bill and late fee at once.
//   upiApp: { pkg } | { chooser: true }     card: { number, month, year, cvv, name }
//   confirmPaid(): resolves true when the money has arrived (asked when the app gives no proof)
export async function payPlatform({ kind, id, amountPaise, upiApp, card, user, confirmPaid }) {
    let start;
    try {
        start = kind === 'rent' ? await startRentPay(id) : kind === 'dues' ? await startDuesPay() : await startTopupPay(amountPaise);
    } catch (e) {
        if (e?.response?.status === 409 && (await confirmPaid().catch(() => false))) return { status: 'paid' };
        return { status: 'failed', message: text(e, 'Could not start the payment') };
    }
    const verifyOnce = (proof) => (kind === 'rent' ? verifyRentPay(id, proof) : kind === 'dues' ? verifyDuesPay(proof) : verifyTopupPay(start.topupId, proof));

    if (upiApp?.pkg) rememberUpiApp(upiApp.pkg);
    Razorpay.initRazorpay(start.keyId);   // the promise it returns never settles, so it is not awaited

    const common = {
        key_id: start.keyId, order_id: start.rzpOrderId, amount: String(start.amountPaise), currency: start.currency || 'INR',
        description: start.description || 'Payment', email: user?.email || FALLBACK_EMAIL, contact: tenDigits(user?.phone),
    };
    const options = card
        ? {
            ...common, method: 'card',
            'card[name]': card.name || user?.name || 'Shop owner', 'card[number]': String(card.number).replace(/\s/g, ''),
            'card[expiry_month]': String(card.month).padStart(2, '0'), 'card[expiry_year]': String(card.year).slice(-2), 'card[cvv]': String(card.cvv),
        }
        : { ...common, method: 'upi', ...(upiApp?.pkg ? { upi_app_package_name: upiApp.pkg } : {}), '_[flow]': 'intent' };

    let proof;
    const t0 = Date.now();
    try {
        proof = await Razorpay.open(options);
    } catch (e) {
        if (isCancel(e)) return (await confirmPaid().catch(() => false)) ? { status: 'paid' } : { status: 'cancelled', message: 'Payment cancelled' };
        // the chosen UPI app refused a direct launch: try once more and let Android show its own chooser
        if (!card && upiApp?.pkg && Date.now() - t0 < 5000) {
            try {
                const { upi_app_package_name: _drop, ...open } = options;
                proof = await Razorpay.open(open);
            } catch (e2) {
                if (isCancel(e2)) return { status: 'cancelled', message: 'Payment cancelled' };
                if (await confirmPaid().catch(() => false)) return { status: 'paid' };
                return { status: 'failed', message: text(e2, 'This UPI app could not start the payment. Try another app.') };
            }
        } else {
            if (await confirmPaid().catch(() => false)) return { status: 'paid' };
            return { status: 'failed', message: text(e, 'Payment failed') };
        }
    }

    // some apps report "success" even when the owner backed out: no proof means look at the server's record instead
    const hasProof = proof?.razorpay_order_id && proof?.razorpay_payment_id && proof?.razorpay_signature;
    if (!hasProof) {
        for (let i = 0; i < 4; i += 1) {
            if (await confirmPaid().catch(() => false)) return { status: 'paid' };
            await wait(1500);
        }
        return { status: 'cancelled', message: 'Payment not completed' };
    }

    const body = { razorpay_order_id: proof.razorpay_order_id, razorpay_payment_id: proof.razorpay_payment_id, razorpay_signature: proof.razorpay_signature };
    let last;
    for (let i = 0; i < 3; i += 1) {
        try {
            const r = await verifyOnce(body);
            if (r.paid) return { status: 'paid' };
            await wait(1500);                                   // a late capture: give it a moment, then look again
            if (await confirmPaid().catch(() => false)) return { status: 'paid' };
            return { status: 'failed', message: 'Payment was not completed' };
        } catch (e) {
            last = e;
            if (e?.response && e.response.status < 500) break;  // the server said no: do not repeat
            await wait(1500 * (i + 1));                          // network or server trouble: the money may be taken, so ask again
        }
    }
    if (await confirmPaid().catch(() => false)) return { status: 'paid' };
    if (last?.response && last.response.status < 500) return { status: 'failed', message: 'The payment could not be confirmed' };
    return { status: 'pending', message: 'We could not confirm the payment yet. If money was taken it will show up shortly.' };
}
