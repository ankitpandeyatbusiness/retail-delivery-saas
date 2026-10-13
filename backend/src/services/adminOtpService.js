// Superadmin login OTP: make, send, check. Limits are kept in MongoDB (RateLimiterMongo), not in memory.
//   SUPERADMIN_OTP_CONSOLE=true  -> the OTP is printed in the server log (no SMS)
//   otherwise                    -> real SMS adapter; the PLATFORM pays (a PlatformSmsCost row, no wallet)
const crypto = require('crypto');
const mongoose = require('mongoose');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const SuperAdmin = require('../models/SuperAdmin');
const AdminOtp = require('../models/AdminOtp');
const PlatformSmsCost = require('../models/PlatformSmsCost');
const smsAdapter = require('./adapters/sms');
const wallet = require('./smsWalletService');

const PHONE_RE = /^[6-9]\d{9}$/;
const OTP_RE = /^\d{6}$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_PHONE_FAILS = 10;   // wrong OTPs per phone in 30 minutes, then the phone is locked

const BAD = { ok: false, status: 400, error: 'Invalid or expired OTP' };
const consoleMode = () => process.env.SUPERADMIN_OTP_CONSOLE === 'true';
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const hashOtp = (otp, phone) =>
    crypto.createHmac('sha256', process.env.OTP_PEPPER).update(`admin|${phone}|${otp}`).digest('hex');

let limiters = null;
function getLimiters() {
    if (limiters) return limiters;
    if (mongoose.connection.readyState !== 1) return null;
    const storeClient = mongoose.connection;
    const make = (points, duration, keyPrefix) => new RateLimiterMongo({ storeClient, points, duration, keyPrefix });
    limiters = {
        sendIp: make(30, 60 * 60, 'rl_adm_send_ip'),
        send30s: make(1, 30, 'rl_adm_send_30s'),
        sendHr: make(5, 60 * 60, 'rl_adm_send_hr'),
        verifyIp: make(100, 60 * 60, 'rl_adm_ver_ip'),
        lockout: make(MAX_PHONE_FAILS, 30 * 60, 'rl_adm_lock'),
        loginFail: make(5, 15 * 60, 'rl_adm_pw_fail'),   // wrong passwords per IP
    };
    return limiters;
}

// IP points are never given back. Phone points are given back if a later limiter says no.
async function consumeSend(ip, phone) {
    const L = getLimiters();
    const taken = [];
    try {
        await L.sendIp.consume(ip);
        for (const l of [L.send30s, L.sendHr]) { await l.consume(phone); taken.push(l); }
    } catch (rej) {
        await Promise.allSettled(taken.map((l) => l.reward(phone, 1)));
        throw rej;
    }
}
const refundSend = (phone) => {
    const L = getLimiters();
    return Promise.allSettled([L.send30s.reward(phone, 1), L.sendHr.reward(phone, 1)]);
};

// Registered phone -> OTP made and sent. Other phone -> nothing happens (the answer looks the same).
async function sendLoginOtp(phone, ip) {
    const admin = await SuperAdmin.findOne({ phones: phone, isActive: true }).select('_id').lean();
    if (!admin) return { ok: true };

    const otp = crypto.randomInt(100000, 1000000).toString();
    const doc = await AdminOtp.create({
        adminId: admin._id, phone, otpHash: hashOtp(otp, phone),
        expiresAt: new Date(Date.now() + OTP_TTL_MS), ipHash: sha256(ip || 'unknown'),
    });
    await AdminOtp.updateMany({ phone, consumed: false, _id: { $ne: doc._id } }, { $set: { consumed: true } });

    if (consoleMode()) {
        console.log(`[ADMIN OTP] ${phone}: ${otp}  (valid 5 minutes)`);
        return { ok: true };
    }
    try {
        await smsAdapter.sendOtp({ phone, otp, tenant: null });
    } catch (e) {
        console.error('Admin OTP SMS failed:', e.message);
        await AdminOtp.updateOne({ _id: doc._id }, { $set: { consumed: true } });
        return { ok: false };
    }
    if (wallet.shouldCharge()) {
        await PlatformSmsCost.create({
            eventKey: 'admin_login_otp', costPaise: wallet.DEFAULTS.costPerSmsPaise, phoneMasked: wallet.mask(phone),
        }).catch(() => { });
    }
    return { ok: true };
}

// Returns { ok:true, admin } or { ok:false, status, error, retryAfter? }
async function verifyLoginOtp(phone, otp) {
    const L = getLimiters();
    const lock = await L.lockout.get(phone);
    if (lock && lock.consumedPoints >= MAX_PHONE_FAILS) {
        return { ok: false, status: 429, error: 'Too many requests. Please wait and try again.', retryAfter: Math.max(1, Math.ceil(lock.msBeforeNext / 1000)) };
    }
    const fail = async () => { await L.lockout.consume(phone).catch(() => { }); return BAD; };

    // count this try against the newest open OTP, in one atomic step
    const rec = await AdminOtp.findOneAndUpdate(
        { phone, consumed: false, expiresAt: { $gt: new Date() } },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after', sort: { createdAt: -1 } },
    );
    if (!rec) return fail();
    if (rec.attempts > MAX_ATTEMPTS) {
        await AdminOtp.updateOne({ _id: rec._id }, { $set: { consumed: true } });
        return fail();
    }

    const given = Buffer.from(hashOtp(otp, phone), 'hex');
    const real = Buffer.from(rec.otpHash, 'hex');
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
        if (rec.attempts >= MAX_ATTEMPTS) await AdminOtp.updateOne({ _id: rec._id }, { $set: { consumed: true } });
        return fail();
    }

    // single use: only one parallel request can win
    const claimed = await AdminOtp.findOneAndUpdate({ _id: rec._id, consumed: false }, { $set: { consumed: true } });
    if (!claimed) return BAD;
    await L.lockout.delete(phone).catch(() => { });

    const admin = await SuperAdmin.findOne({ _id: rec.adminId, phones: phone, isActive: true });
    if (!admin) return BAD;
    await SuperAdmin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });
    return { ok: true, admin };
}

module.exports = { PHONE_RE, OTP_RE, getLimiters, consumeSend, refundSend, sendLoginOtp, verifyLoginOtp };