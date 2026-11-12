// "Server setup": which of the settings that live on the SERVER (the .env of the host) are set, which are missing, and what each is for.
// Only whether a setting is present is told, never its value. Settings that are saved from the app (the SMS provider, My Razorpay) count as set when saved there.
const PlatformSettings = require('../models/PlatformSettings');

const has = (...names) => names.every((n) => !!process.env[n]);
const anyOf = (...names) => names.some((n) => !!process.env[n]);
const test = (flag) => process.env[flag] === 'true';

async function build() {
    const row = await PlatformSettings.findById('main').select('smsSetup payments').lean().catch(() => null);
    let smsReady = false;
    try { smsReady = (await require('./smsPlatformSetup').view()).ready; } catch (e) { smsReady = false; }
    const rzpSaved = !!(row && row.payments && row.payments.keyId);   // keys saved in My Razorpay (the webhook secret is made with them)
    const g = (id, title, level, why, how, items, extra = {}) => {
        const missing = items.filter((i) => !i.set).map((i) => i.label);
        const status = extra.test ? 'test' : missing.length ? 'missing' : 'ok';
        return { id, title, level, why, how, items, missing, status, note: extra.note || '' };
    };
    const it = (key, label, set = has(key)) => ({ key, label, set });
    const groups = [
        g('secrets', 'Login and security secrets', 'must', 'They sign every login and hide phone numbers. Without them the server will not start in production.', 'Set once on the host, long random text each. Never change them later: everyone is logged out.',
            [it('JWT_ACCESS_SECRET', 'Login token secret'), it('JWT_REFRESH_SECRET', 'Refresh token secret'), it('PHONE_HASH_SECRET', 'Phone hashing secret'), it('OTP_PEPPER', 'OTP secret'), it('DELIVERY_PIN_SECRET', 'Delivery PIN secret')]),
        g('vault', 'Vault key (SECRETS_KEY)', 'must', 'Needed to keep keys you type in the app (the SMS auth key, shop SMS keys, payment keys) encrypted. Without it those screens refuse to save.', '32 random bytes as base64. Set once on the host.', [it('SECRETS_KEY', 'Vault key')]),
        g('links', 'Web addresses', 'should', 'The links inside messages, emails and PDFs.', 'Your public server address and the panel address.', [it('PUBLIC_BASE_URL', 'Public address'), it('SERVER_URL', 'Server address')]),
        g('demo', 'Public demo and QR codes', 'should', 'The address printed in the QR codes (it must stay yours for ever), where the demo website lives, and who may call the server from it.', 'On the host: QR_BASE_URL (your own https address, no slash at the end), DEMO_SITE_URL (the demo website), SHOP_WEB_URL_TEMPLATE like https://{slug}.yourdomain.in. See docs/demo-go-live.md.',
            [it('QR_BASE_URL', 'QR address'), { key: 'DEMO_SITE_URL', label: 'Demo website address', set: anyOf('DEMO_SITE_URL', 'PLATFORM_WEB_DOMAIN') }, { key: 'SHOP_WEB_URL_TEMPLATE', label: 'Shop website address', set: anyOf('SHOP_WEB_URL_TEMPLATE', 'PLATFORM_WEB_DOMAIN') }]),
        g('sms', 'SMS (MSG91 and DLT)', 'must', 'Login OTPs, order and bill messages. Until it is ready SMS are only printed in the server log.', 'Fill More > SMS and DLT setup in the app; register your texts on DLT first (docs/dlt-templates-to-register.md).',
            [{ key: 'sms', label: 'Auth key, sender ID and entity ID', set: smsReady }], { test: test('SMS_MOCK') }),
        g('payments', 'Online payments (Razorpay)', 'must', 'Rent and SMS top-ups paid by shops, and the webhook that records them.', 'Fill More > Money settings > My Razorpay, or set the keys on the host.',
            [{ key: 'rzp', label: 'Razorpay keys', set: rzpSaved || has('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET') }, { key: 'RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret', set: rzpSaved || has('RAZORPAY_WEBHOOK_SECRET') }], { test: test('PAYMENTS_MOCK') }),
        g('push', 'Push alerts (Firebase)', 'must', 'Alerts to your phone and to every owner, rider, cook, waiter and customer when the app is closed.', 'The Firebase service account JSON, converted to base64, as FCM_SERVICE_ACCOUNT_B64.', [it('FCM_SERVICE_ACCOUNT_B64', 'Firebase service account')], { test: test('PUSH_MOCK') }),
        g('images', 'Pictures and files (R2)', 'must', 'Dish pictures, logos, banners, photos in complaints.', 'Cloudflare R2 account, keys, bucket and the public address.',
            [it('R2_ACCOUNT_ID', 'R2 account'), it('R2_ACCESS_KEY_ID', 'R2 access key'), it('R2_SECRET_ACCESS_KEY', 'R2 secret'), it('R2_BUCKET', 'Bucket'), it('R2_PUBLIC_URL', 'Public address')], { test: test('STORAGE_MOCK') }),
        g('backups', 'Backups', 'must', 'The nightly copy of the whole database. Without it a bad day cannot be undone.', 'A private R2 bucket for backups (same R2 keys as the pictures).', [it('BACKUP_R2_BUCKET', 'Backup bucket')], { test: test('STORAGE_MOCK') }),
        g('email', 'Email (Brevo)', 'should', 'Monthly reports, invoices and the emails you ask to send.', 'A Brevo key and the sender address.', [it('BREVO_API_KEY', 'Brevo key'), it('MAIL_FROM_EMAIL', 'Sender address')], { test: test('EMAIL_MOCK') }),
        g('maps', 'Maps (Google)', 'should', 'Pointing to a shop on the map, delivery distance and live tracking. The monthly limits are in Live tracking.', 'A Google key (server) and one for the app.', [it('GOOGLE_MAPS_API_KEY', 'Google server key')]),
        g('errors', 'Error reports (Sentry)', 'optional', 'Tells you when the server crashes.', 'A Sentry address (DSN).', [it('SENTRY_DSN', 'Sentry address')]),
        g('supreme', 'Supreme admin phone', 'should', 'The one login that can change money, agreements and everything platform-wide. It cannot be changed from any screen, on purpose.', 'SUPREME_ADMIN_PHONE on the host. If it is not set, a built-in default number is used.', [it('SUPREME_ADMIN_PHONE', 'Supreme admin phone')]),
    ];
    const rank = { must: 0, should: 1, optional: 2 };
    const worst = groups.filter((x) => x.level !== 'optional' && x.status !== 'ok');
    return {
        groups,
        summary: { total: groups.length, ok: groups.filter((x) => x.status === 'ok').length, missing: groups.filter((x) => x.status === 'missing' && x.level === 'must').length, test: groups.filter((x) => x.status === 'test').length, needsYou: worst.sort((a, b) => rank[a.level] - rank[b.level]).map((x) => x.title) },
        production: process.env.NODE_ENV === 'production',
    };
}

module.exports = { build };
