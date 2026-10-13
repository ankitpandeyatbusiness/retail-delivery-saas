// SMS adapter. Business code calls ONLY this file, never a provider directly.
//
//   const sms = require('../services/adapters/sms');
//   await sms.sendOtp({ phone, otp, tenant });
//
// SMS_MOCK=true  -> prints the message in the server console (development)
// otherwise      -> the real provider (MSG91 sendhttp). Only deliver() knows the provider.
//
// Customer-facing SMS (otp, order) use the shop's OWN sender and keys when the superadmin switched them on
// (services/smsConfig.js). Everything else uses the platform sender.
// Platform env: SMS_AUTH_KEY, SMS_SENDER_ID, SMS_ENTITY_ID, SMS_DEFAULT_TEMPLATE_ID, optional SMS_TEMPLATE_<KEY>.
//
// send() MUST throw if the SMS was not sent, so the caller can refund limits and the wallet.
// It returns { providerMessageId } for SmsLog.
const smsConfig = require('../smsConfig');

const mockProvider = {
    async send({ to, text, purpose, tenant }) {
        console.log(`\n[MOCK SMS] (${purpose}) to ${to} for ${tenant?.name || 'platform'}: ${text}\n`);
        return { providerMessageId: 'mock' };
    },
};

async function deliver({ to, text, senderId, templateId, authKey }) {
    if (!authKey || !senderId) throw new Error('SMS provider not configured');
    if (!templateId) throw new Error('No DLT template id for this SMS');
    const params = new URLSearchParams({
        authkey: authKey,
        mobiles: `91${String(to).replace(/\D/g, '').slice(-10)}`,
        message: text,
        sender: senderId,
        route: '4',
        country: '91',
        DLT_TE_ID: templateId,
    });
    const res = await fetch(process.env.SMS_API_URL || 'https://api.msg91.com/api/sendhttp.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10000),
    });
    const body = (await res.text()).trim();
    if (!res.ok || /error|invalid|fail/i.test(body)) throw new Error(`SMS provider refused (${res.status}): ${body.slice(0, 120)}`);
    return { providerMessageId: body.slice(0, 100) || 'sent' };
}

// purpose: 'otp' | 'order' | 'bill' | 'alert' | 'platform_alert'
async function send({ to, text, purpose, tenant, templateKey }) {
    if (process.env.SMS_MOCK === 'true') return mockProvider.send({ to, text, purpose, tenant });
    const route = await smsConfig.resolve({ tenantId: tenant && tenant._id, purpose, templateKey });
    return deliver({ to, text, ...route });
}

// The text must match your DLT-approved OTP template when the real provider is connected.
const sendOtp = ({ phone, otp, tenant }) =>
    send({ to: phone, purpose: 'otp', text: `OTP ${otp}`, tenant, templateKey: 'otp' });

module.exports = { send, sendOtp };