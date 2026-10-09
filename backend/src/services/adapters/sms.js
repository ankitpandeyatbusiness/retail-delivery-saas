// SMS adapter. Business code calls ONLY this file, never a provider directly.
//
//   const sms = require('../services/adapters/sms');
//   await sms.sendOtp({ phone, otp, tenant });
//
// SMS_MOCK=true  -> prints the message in the server console (development)
// otherwise      -> the real provider (not connected yet, DLT is pending)
//
// send() MUST throw if the SMS was not sent, so the caller can refund limits (or the wallet in Phase 2).
// It returns { providerMessageId } so Phase 2 can write it in SmsLog.

const mockProvider = {
    async send({ to, text, purpose, tenant }) {
        console.log(`\n[MOCK SMS] (${purpose}) to ${to} for ${tenant?.name || 'platform'}: ${text}\n`);
        return { providerMessageId: 'mock' };
    },
};

const realProvider = {
    async send() {
        // TODO (after DLT approval): call the real SMS provider here and return its message id.
        // Use the approved template text and template id. Throw on any failure.
        throw new Error('SMS provider not configured');
    },
};

const provider = () => (process.env.SMS_MOCK === 'true' ? mockProvider : realProvider);

// purpose: 'otp' | 'bill' | 'alert'
async function send({ to, text, purpose, tenant }) {
    return provider().send({ to, text, purpose, tenant });
}

// The text must match your DLT-approved OTP template when the real provider is connected.
const sendOtp = ({ phone, otp, tenant }) =>
    send({ to: phone, purpose: 'otp', text: `OTP ${otp}`, tenant });

module.exports = { send, sendOtp };