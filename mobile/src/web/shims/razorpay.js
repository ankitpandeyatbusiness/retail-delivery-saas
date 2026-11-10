// Web stand-in for react-native-customui (Razorpay's phone-only Custom UI SDK): Razorpay's own hosted checkout (checkout.js).
// The server side is the SAME as in the app: the server makes the Razorpay order with the shop's own keys, we open the payment window, and the
// proof (razorpay_order_id, razorpay_payment_id, razorpay_signature) goes back to the server, which verifies it with Razorpay.
// The hosted window offers every method itself (UPI, cards, netbanking, wallets), so the options that pick a UPI app or carry card numbers are
// ignored here: a website never handles card numbers.
const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

let loading = null;
function loadCheckout() {
    if (typeof window === 'undefined') return Promise.reject(new Error('No browser'));
    if (window.Razorpay) return Promise.resolve();
    if (!loading) {
        loading = new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = SCRIPT;
            el.async = true;
            el.onload = () => resolve();
            el.onerror = () => { loading = null; el.remove(); reject({ code: 'WEB_UNAVAILABLE', description: 'Could not open the payment window. Check your internet and try again.' }); };
            document.head.appendChild(el);
        });
    }
    return loading;
}

const brandColor = () => {
    try { const m = document.head.querySelector('meta[name="theme-color"]'); return (m && m.getAttribute('content')) || undefined; } catch (e) { return undefined; }
};

// options as the app builds them: { key_id, order_id, amount (paise, as text), currency, description, email, contact, ... }
// Resolves with the proof when the customer paid. Rejects { code: 2, description: 'Payment cancelled' } (Razorpay's cancel code, which the
// callers already understand) when the window is closed, or { description } when the window cannot be opened.
function open(options) {
    return loadCheckout().then(() => new Promise((resolve, reject) => {
        let done = false;
        const rzp = new window.Razorpay({
            key: options.key_id,
            order_id: options.order_id,
            amount: options.amount,
            currency: options.currency || 'INR',
            name: (typeof document !== 'undefined' && document.title) || undefined,
            description: options.description,
            prefill: { contact: options.contact || undefined, email: options.email || undefined },
            theme: { color: brandColor() },
            retry: { enabled: true },
            handler: (resp) => { done = true; resolve(resp); },
            modal: {
                escape: true,
                ondismiss: () => { if (!done) { done = true; reject({ code: 2, description: 'Payment cancelled' }); } },
            },
        });
        // a failed attempt keeps the window open so the customer can try another way; only closing it ends the payment
        try { rzp.open(); } catch (e) { done = true; reject({ description: 'Could not open the payment window.' }); }
    }));
}

const Razorpay = {
    open,
    initRazorpay: async () => { loadCheckout().catch(() => { }); },   // warm the script up before the customer taps Pay
    getAppsWhichSupportUPI: async () => ({ data: [] }),
    getPaymentMethods: async () => ({}),
};
export default Razorpay;
