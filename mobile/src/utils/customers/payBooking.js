// Pays the deposit of a table booking (the shop's own Razorpay keys). The seats are held while the guest pays.
//   1. POST /bookings            -> the booking is held and the server made the Razorpay order ({ booking, pay })
//   2. Razorpay.open             -> Android shows its UPI app chooser, he pays, we are brought back
//   3. POST /bookings/:id/verify -> the server checks the proof and asks Razorpay; only then is the booking confirmed
// Resolves { status: 'paid' | 'cancelled' | 'failed' | 'pending', message? }. Never throws.
import Razorpay from 'react-native-customui';
import { verifyBooking, checkBooking } from '../../api/customers/shopApi';
import { warmRazorpay } from './payOnline';

const PAYMENT_CANCELED = 2;   // Razorpay error code
const FALLBACK_EMAIL = 'orders@retailsaas.app';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tenDigits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const isCancel = (e) => e?.code === PAYMENT_CANCELED || /cancel/i.test(e?.description || '');

// "Did it get paid?" answered by the server (which asks Razorpay), for when the proof never came back
async function settled(id) {
    for (let i = 0; i < 5; i += 1) {
        try { if ((await checkBooking(id))?.paid) return true; } catch (e) { /* try again */ }
        await wait(1500);
    }
    return false;
}

async function finish(id, proof) {
    const hasProof = proof?.razorpay_order_id && proof?.razorpay_payment_id && proof?.razorpay_signature;
    if (!hasProof) return (await settled(id)) ? { status: 'paid' } : { status: 'cancelled', message: 'Payment not completed' };
    for (let i = 0; i < 3; i += 1) {
        try {
            const r = await verifyBooking(id, { razorpay_order_id: proof.razorpay_order_id, razorpay_payment_id: proof.razorpay_payment_id, razorpay_signature: proof.razorpay_signature });
            if (r.paid) return { status: 'paid' };
            return (await settled(id)) ? { status: 'paid' } : { status: 'failed', message: 'Payment was not completed' };
        } catch (e) {
            if (e?.response && e.response.status < 500) return (await settled(id)) ? { status: 'paid' } : { status: 'failed', message: 'The payment could not be confirmed' };
            await wait(1500 * (i + 1));   // network or server trouble: the money may already be taken, so try again
        }
    }
    return { status: 'pending', message: 'We are confirming your payment. Your booking will update shortly.' };
}

// booking: the held booking; pay: { keyId, rzpOrderId, amountPaise, currency } from the server; user: { email, phone }
// upiApp: { pkg } opens that app, { chooser: true } or nothing shows Android's list.   card: { number, month, year, cvv, name } pays by card.
export async function payBooking({ booking, pay, user, upiApp, card }) {
    warmRazorpay(pay.keyId);   // started once and kept ready, like for an order: opening it cold can fail and look like a cancel
    const options = {
        key_id: pay.keyId, order_id: pay.rzpOrderId, amount: String(pay.amountPaise), currency: pay.currency || 'INR',
        description: 'Table booking deposit', email: user?.email || FALLBACK_EMAIL, contact: tenDigits(user?.phone || booking?.phone),
        ...(card ? {
            method: 'card', 'card[name]': card.name || 'Customer', 'card[number]': String(card.number).replace(/\s/g, ''),
            'card[expiry_month]': String(card.month).padStart(2, '0'), 'card[expiry_year]': String(card.year).slice(-2), 'card[cvv]': String(card.cvv),
        } : { method: 'upi', ...(upiApp?.pkg ? { upi_app_package_name: upiApp.pkg } : {}), '_[flow]': 'intent' }),
    };
    let proof;
    try { proof = await Razorpay.open(options); }
    catch (e) {
        if (await settled(booking._id)) return { status: 'paid' };   // some apps report "cancelled" after the money was taken
        if (isCancel(e)) return { status: 'cancelled', message: 'Payment cancelled' };
        if (__DEV__) console.warn('[pay] booking payment failed', JSON.stringify(e));   // the bank's or Razorpay's own words are not shown to the guest
        return { status: 'failed', message: 'Payment failed. Try another card or UPI. Your table is held for a few minutes.' };
    }
    return finish(booking._id, proof);
}
