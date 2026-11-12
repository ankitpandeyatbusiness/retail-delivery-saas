// The private demo login: ONE phone number + OTP (set by the supreme admin) that opens any shop as a brand-new person.
// Used by the owner, friends and Razorpay reviewers. No SMS is ever sent for it. The OTP is stored only as a keyed hash.
const crypto = require('crypto');
const PlatformSettings = require('../models/PlatformSettings');
const User = require('../models/User');

const OTP_RE = /^\d{6}$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const TTL_MS = 30 * 1000;
let cache = null;   // { at, doc }

const hashOtp = (otp, phone) => crypto.createHmac('sha256', process.env.OTP_PEPPER || 'x').update(`demo:${phone}:${otp}`).digest('hex');
const fail = (msg) => { const e = new Error(msg); e.status = 400; return e; };

async function load() {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.doc;
    const s = await PlatformSettings.findById('main').select('+demo.otpHash').lean();
    const d = (s && s.demo) || {};
    const doc = { enabled: !!d.enabled && !!d.phone && !!d.otpHash, phone: d.phone || null, otpHash: d.otpHash || null };
    cache = { at: Date.now(), doc };
    return doc;
}
const invalidate = () => { cache = null; };

// is this phone the demo phone, and is the demo login on?
async function isDemoPhone(phone) {
    const d = await load();
    return !!(d.enabled && d.phone && String(phone) === d.phone);
}

async function checkOtp(phone, otp) {
    const d = await load();
    if (!d.enabled || phone !== d.phone || !OTP_RE.test(String(otp))) return false;
    const a = Buffer.from(hashOtp(otp, phone), 'hex');
    const b = Buffer.from(d.otpHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function status() {
    const s = await PlatformSettings.findById('main').select('+demo.otpHash').lean();
    const d = (s && s.demo) || {};
    return { enabled: !!d.enabled && !!d.phone && !!d.otpHash, phone: d.phone || null, hasOtp: !!d.otpHash, setAt: d.setAt || null, lastLoginAt: d.lastLoginAt || null, logins: d.logins || 0 };
}

// supreme admin: set or change the number and OTP
async function set({ phone, otp, enabled = true }) {
    phone = String(phone || '').trim();
    otp = String(otp || '').trim();
    if (!PHONE_RE.test(phone)) throw fail('Enter a 10 digit Indian mobile number');
    if (!OTP_RE.test(otp)) throw fail('The OTP must be 6 digits');
    // a real owner, rider or staff number must never become the demo number (the demo person would collide with a real account)
    if (await User.exists({ phone, role: { $ne: 'customer' } })) throw fail('This number belongs to a shop owner, rider or staff member. Use a different number for the demo.');
    await PlatformSettings.findByIdAndUpdate('main',
        { $set: { 'demo.enabled': !!enabled, 'demo.phone': phone, 'demo.otpHash': hashOtp(otp, phone), 'demo.setAt': new Date() } },
        { upsert: true, setDefaultsOnInsert: true });
    invalidate();
    return status();
}

async function setEnabled(enabled) {
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'demo.enabled': !!enabled } }, { upsert: true, setDefaultsOnInsert: true });
    invalidate();
    return status();
}

async function clear() {
    await PlatformSettings.findByIdAndUpdate('main',
        { $set: { 'demo.enabled': false }, $unset: { 'demo.phone': 1, 'demo.otpHash': 1, 'demo.setAt': 1 } },
        { upsert: true, setDefaultsOnInsert: true });
    invalidate();
    return status();
}

async function noteLogin() {
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'demo.lastLoginAt': new Date() }, $inc: { 'demo.logins': 1 } }).catch(() => { });
}

module.exports = { isDemoPhone, checkOtp, set, setEnabled, clear, status, noteLogin, invalidate };
