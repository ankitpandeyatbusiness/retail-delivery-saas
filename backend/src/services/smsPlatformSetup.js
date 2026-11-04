// The platform's SMS provider setup (MSG91 + DLT), kept in the database so it can be set from the superadmin app:
// sender ID, entity ID, auth key (encrypted), a default template ID and one template ID per text.
// A value set on the SERVER (SMS_SENDER_ID, SMS_ENTITY_ID, SMS_AUTH_KEY, SMS_TEMPLATE_<NAME> ...) always wins, so nothing already working changes.
// Kept in PlatformSettings.smsSetup. Only the supreme admin changes it (middlewares/supremeAdmin.js).
const PlatformSettings = require('../models/PlatformSettings');
const box = require('../utils/secretBox');
const { TEMPLATES } = require('../notifications/templates/sms');
const { httpError } = require('../middlewares/apiErrors');

const TTL_MS = 30 * 1000;
let cache = null;   // { at, s }

const KEYS = ['otp', ...Object.keys(TEMPLATES)];
const NAMES = {
    otp: 'Login OTP', order_new: 'New order (to the owner)', order_accepted: 'Order accepted', order_out_for_delivery: 'Order on the way',
    order_delivered: 'Order delivered', order_cancelled: 'Order cancelled', order_unaccepted_reminder: 'Order not accepted reminder',
    bill_issued: 'New bill', delivery_pin: 'Delivery PIN', rider_sos: 'Rider help alert', bill_overdue: 'Bill overdue', shop_paused: 'Shop paused',
};
const envName = (k) => String(k).toUpperCase().replace(/[^A-Z0-9]/g, '_');
const envTemplate = (k) => process.env[`SMS_TEMPLATE_${envName(k)}`] || process.env[`DLT_TEMPLATE_${envName(k)}`] || '';

async function saved() {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.s;
    const row = await PlatformSettings.findById('main').select('smsSetup').lean();
    cache = { at: Date.now(), s: row?.smsSetup || {} };
    return cache.s;
}
const invalidate = () => { cache = null; };

// what an SMS is really sent with: the server value first, then the saved one
async function effective() {
    const s = await saved();
    let authKey = process.env.SMS_AUTH_KEY || '';
    if (!authKey && s.authKeyEnc) { try { authKey = box.decrypt(s.authKeyEnc); } catch (e) { authKey = ''; } }
    return {
        senderId: process.env.SMS_SENDER_ID || s.senderId || '',
        entityId: process.env.SMS_ENTITY_ID || s.entityId || '',
        authKey,
        defaultTemplateId: process.env.SMS_DEFAULT_TEMPLATE_ID || s.defaultTemplateId || '',
        brandName: process.env.SMS_BRAND_NAME || s.brandName || '',
        templateId: (key) => envTemplate(key) || (s.templateIds && s.templateIds[key]) || '',
    };
}
// the brand name for the login OTP, without waiting (the last loaded value)
const brandSync = () => process.env.SMS_BRAND_NAME || (cache && cache.s && cache.s.brandName) || '';

const mask = (v) => (v ? `${'•'.repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}` : '');

// what the screen shows: every value with where it comes from, the key only as "set", and every text with its template ID
async function view() {
    const s = await saved();
    const src = (envV, savedV) => (envV ? 'server' : savedV ? 'saved' : 'missing');
    const templates = KEYS.map((k) => {
        const e = envTemplate(k);
        const id = e || (s.templateIds && s.templateIds[k]) || '';
        return {
            key: k, name: NAMES[k] || k, text: k === 'otp' ? require('./adapters/sms').OTP_TEXT.replace('{name}', '{#var#}').replace('{otp}', '{#var#}') : TEMPLATES[k].text,
            templateId: id, source: e ? 'server' : id ? 'saved' : 'missing', serverName: `SMS_TEMPLATE_${envName(k)}`,
        };
    });
    return {
        mock: process.env.SMS_MOCK === 'true',
        senderId: { value: process.env.SMS_SENDER_ID || s.senderId || '', source: src(process.env.SMS_SENDER_ID, s.senderId) },
        entityId: { value: process.env.SMS_ENTITY_ID || s.entityId || '', source: src(process.env.SMS_ENTITY_ID, s.entityId) },
        authKey: { set: !!(process.env.SMS_AUTH_KEY || s.authKeyEnc), hint: process.env.SMS_AUTH_KEY ? mask(process.env.SMS_AUTH_KEY) : s.authKeyEnc ? 'saved' : '', source: src(process.env.SMS_AUTH_KEY, s.authKeyEnc) },
        defaultTemplateId: { value: process.env.SMS_DEFAULT_TEMPLATE_ID || s.defaultTemplateId || '', source: src(process.env.SMS_DEFAULT_TEMPLATE_ID, s.defaultTemplateId) },
        brandName: { value: process.env.SMS_BRAND_NAME || s.brandName || '', source: src(process.env.SMS_BRAND_NAME, s.brandName) },
        templates,
        missing: templates.filter((t) => !t.templateId && !(process.env.SMS_DEFAULT_TEMPLATE_ID || s.defaultTemplateId)).length,
        ready: !!((process.env.SMS_AUTH_KEY || s.authKeyEnc) && (process.env.SMS_SENDER_ID || s.senderId) && (process.env.SMS_ENTITY_ID || s.entityId)),
        lastTest: s.lastTest || null,
    };
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const text = (v, label, max = 40) => {
    const x = String(v ?? '').trim();
    if (x.length > max) throw httpError(400, `${label} is too long`);
    if (x && label !== 'Brand name' && !ID.test(x)) throw httpError(400, `${label} may only have letters, numbers, - and _`);
    return x;
};

// body: { senderId?, entityId?, defaultTemplateId?, brandName?, authKey?, templateIds?: { key: id } }; an empty value clears it
async function save(body = {}) {
    const set = {};
    if (body.senderId !== undefined) set['smsSetup.senderId'] = text(body.senderId, 'Sender ID', 11);
    if (body.entityId !== undefined) set['smsSetup.entityId'] = text(body.entityId, 'Entity ID');
    if (body.defaultTemplateId !== undefined) set['smsSetup.defaultTemplateId'] = text(body.defaultTemplateId, 'Default template ID');
    if (body.brandName !== undefined) set['smsSetup.brandName'] = text(body.brandName, 'Brand name', 30).replace(/[^\p{L}\p{N} &.,'-]/gu, '');
    if (body.authKey !== undefined && String(body.authKey).trim()) {
        const k = String(body.authKey).trim();
        if (k.length < 10 || k.length > 120 || /\s/.test(k)) throw httpError(400, 'That does not look like an auth key');
        try { set['smsSetup.authKeyEnc'] = box.encrypt(k); } catch (e) { throw httpError(409, 'The server cannot keep secrets yet (SECRETS_KEY is not set)'); }
    }
    if (body.templateIds && typeof body.templateIds === 'object') {
        for (const [k, v] of Object.entries(body.templateIds)) {
            if (!KEYS.includes(k)) throw httpError(400, `Unknown text: ${k}`);
            set[`smsSetup.templateIds.${k}`] = text(v, `${NAMES[k]} template ID`);
        }
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to save');
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: set }, { upsert: true });
    invalidate();
    require('./smsConfig').invalidate();
    return view();
}

// a real login-OTP SMS to one number, so you see the registered text arrive on your phone
async function sendTest(phone) {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) throw httpError(400, 'Enter a 10 digit mobile number');
    let result;
    try {
        await require('./adapters/sms').sendOtp({ phone: digits, otp: '482913', tenant: null });
        result = { ok: true, at: new Date(), to: `${'•'.repeat(6)}${digits.slice(-4)}`, note: process.env.SMS_MOCK === 'true' ? 'Mock mode: printed in the server console, not sent' : 'Sent' };
    } catch (e) {
        result = { ok: false, at: new Date(), to: `${'•'.repeat(6)}${digits.slice(-4)}`, note: String(e.message || e).slice(0, 160) };
    }
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'smsSetup.lastTest': result } }, { upsert: true });
    invalidate();
    return result;
}

module.exports = { effective, brandSync, view, save, sendTest, invalidate, KEYS, NAMES };
