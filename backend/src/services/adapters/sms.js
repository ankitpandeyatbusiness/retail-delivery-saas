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
    // the private demo number never receives a real SMS (services/demoMode.js)
    if (require('../demoTenant').isFakePhone(String(to).replace(/\D/g, '').slice(-10)) || await require('../demoMode').isDemoPhone(String(to).replace(/\D/g, '').slice(-10))) return { providerMessageId: 'demo-skipped' };
    if (process.env.SMS_MOCK === 'true') return mockProvider.send({ to, text, purpose, tenant });
    const route = await smsConfig.resolve({ tenantId: tenant && tenant._id, purpose, templateKey });
    if (!route.own && await require('../smsProviderBalance').pauseFor(purpose)) throw new Error('SMS paused: the provider balance is almost empty, kept for login OTPs');
    return deliver({ to, text, ...route });
}

// The login OTP names the SHOP, so every shop's customers see their own shop (the shop name is the first {#var#}, the code the second).
// Register exactly this on DLT:  Your OTP for {#var#} is {#var#}. Valid for 5 minutes. Do not share it.
// If the operator approves other wording, change OTP_TEXT (and only it) to match.
const OTP_TEXT = 'Your OTP for {name} is {otp}. Valid for 5 minutes. Do not share it.';
const shopLabel = (tenant) => {
    const n = String((tenant && tenant.name) || require('../smsPlatformSetup').brandSync() || 'your account').replace(/[^\p{L}\p{N} &.,'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);   // a variable is at most 30 characters
    return n || 'your account';
};
const otpText = ({ otp, tenant }) => OTP_TEXT.replace('{name}', () => shopLabel(tenant)).replace('{otp}', () => String(otp));
const sendOtp = async ({ phone, otp, tenant }) => {
    await require('../smsPlatformSetup').effective().catch(() => { });   // warms the brand name used when there is no shop
    return send({ to: phone, purpose: 'otp', text: otpText({ otp, tenant }), tenant, templateKey: 'otp' });
};

module.exports = { send, sendOtp, otpText, OTP_TEXT };