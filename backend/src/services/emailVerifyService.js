// Proving that an email address is the owner's: we mail a 6-digit code, he types it in the app, and only then is the address saved.
// So the bills and official documents the platform sends can really be received (a typo never gets saved).
//   sendCode({ tenant, user, email })  -> { sent: true, resendInSec, devCode? }   (devCode only when EMAIL_MOCK=true)
//   verify({ tenant, user, email, code }) -> the owner's saved profile fields; the OLD address is told (userEditService)
const crypto = require('crypto');
const EmailCode = require('../models/EmailCode');
const User = require('../models/User');
const emailAdapter = require('./adapters/email');
const emailChannel = require('../notifications/channels/email');
const edit = require('./userEditService');
const cleanEmail = require('../utils/cleanEmail');
const { httpError } = require('../middlewares/apiErrors');

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_PER_DAY = 5;
const MAX_TRIES = 5;

const pepper = () => process.env.OTP_PEPPER || 'dev-pepper';
const hash = (userId, email, code) => crypto.createHmac('sha256', pepper()).update(`email:${userId}:${email}:${code}`).digest('hex');
const same = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function sendCode({ tenant, user, email: raw }) {
    const email = cleanEmail(raw);
    if (!email) throw httpError(400, 'Enter your email address');
    if (!emailAdapter.enabled()) throw httpError(503, 'Email is not set up on the platform yet. Please contact support.');
    if (user.email && user.email.toLowerCase() === email) throw httpError(409, 'This is already your email');

    const now = Date.now();
    const recent = await EmailCode.find({ userId: user._id, createdAt: { $gte: new Date(now - 24 * 3600 * 1000) } }).sort({ createdAt: -1 }).select('createdAt').lean();
    if (recent.length && now - new Date(recent[0].createdAt).getTime() < RESEND_MS) {
        const wait = Math.ceil((RESEND_MS - (now - new Date(recent[0].createdAt).getTime())) / 1000);
        throw httpError(429, `Please wait ${wait} seconds before asking for another code`);
    }
    if (recent.length >= MAX_PER_DAY) throw httpError(429, 'Too many codes today. Please try again tomorrow.');

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await EmailCode.deleteMany({ userId: user._id });   // only the newest code works
    await EmailCode.create({ tenantId: tenant._id, userId: user._id, email, codeHash: hash(user._id, email, code), expiresAt: new Date(now + TTL_MS) });

    const r = await emailChannel.sendDirect({ tenantId: tenant._id, to: email, key: 'email_code', vars: { code, minutes: TTL_MS / 60000, ownerName: user.name } });
    if (!r.queued) throw httpError(503, 'We could not send the email right now. Please try again in a moment.');
    return { sent: true, resendInSec: RESEND_MS / 1000, ...(process.env.EMAIL_MOCK === 'true' ? { devCode: code } : {}) };
}

async function verify({ tenant, user, email: raw, code }) {
    const email = cleanEmail(raw);
    const c = typeof code === 'string' ? code.trim() : String(code ?? '');
    if (!email || !/^\d{6}$/.test(c)) throw httpError(400, 'Enter the 6-digit code from the email');
    const row = await EmailCode.findOne({ userId: user._id, email }).sort({ createdAt: -1 });
    if (!row || row.expiresAt.getTime() < Date.now()) throw httpError(400, 'This code has expired. Please ask for a new one.');
    if (row.attempts >= MAX_TRIES) { await row.deleteOne(); throw httpError(429, 'Too many wrong codes. Please ask for a new one.'); }
    if (!same(row.codeHash, hash(user._id, email, c))) {
        row.attempts += 1;
        await row.save();
        throw httpError(400, `That code is not right. ${Math.max(0, MAX_TRIES - row.attempts)} tries left.`);
    }
    await EmailCode.deleteMany({ userId: user._id });
    const fresh = await User.findOne({ _id: user._id, tenantId: tenant._id }).lean();
    const r = await edit.applyProfile({ tenantId: tenant._id, user: fresh, body: { email }, phoneHint: 'The phone number cannot be changed here' });
    await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
    return { before: r.before, user: r.user };
}

module.exports = { sendCode, verify };
