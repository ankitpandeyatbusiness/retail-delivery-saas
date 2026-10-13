// Superadmin login. Mounted at /api/admin/auth (public) and /api/admin/me (after login) by adminRouter.
//   POST /api/admin/auth/send-otp    { phone }
//   POST /api/admin/auth/verify-otp  { phone, otp }          -> { token, admin }
//   POST /api/admin/auth/login       { email, password }     -> only if SUPERADMIN_PASSWORD_LOGIN=true
//   PUT  /api/admin/me/phones        { phones, verifyPhone, otp }   (needs login + a fresh OTP of a current phone)
const express = require('express');
const SuperAdmin = require('../models/SuperAdmin');
const svc = require('../services/adminOtpService');
const { signAdminToken } = require('../services/superAdminToken');
const auditTrail = require('../middlewares/auditTrail');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const me = express.Router();

if (process.env.SUPERADMIN_OTP_CONSOLE === 'true' && process.env.NODE_ENV === 'production') {
    console.warn('[WARNING] SUPERADMIN_OTP_CONSOLE is ON in production. The login OTP is printed in the server log.');
}

const limitReply = (rej, res) => {
    if (rej instanceof Error) {
        console.error('Admin rate limiter error:', rej.message);
        return res.status(503).json({ error: 'Service unavailable' });
    }
    const retryAfter = Math.max(1, Math.ceil((rej.msBeforeNext || 1000) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.', retryAfter });
};
const ready = (res) => {
    if (svc.getLimiters()) return true;
    res.status(503).json({ error: 'Service unavailable' });
    return false;
};

router.post('/send-otp', wrap(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    if (!svc.PHONE_RE.test(phone)) return res.status(400).json({ error: 'Invalid Indian mobile number' });
    if (!ready(res)) return;
    try { await svc.consumeSend(req.ip || 'unknown', phone); } catch (rej) { return limitReply(rej, res); }

    const r = await svc.sendLoginOtp(phone, req.ip);
    if (!r.ok) {
        await svc.refundSend(phone);   // a provider failure must not use up the tries
        return res.status(503).json({ error: 'Could not send OTP. Please try again.' });
    }
    res.json({ success: true, message: 'If this number is registered, an OTP has been sent' });   // same answer for every number
}));

router.post('/verify-otp', wrap(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const otp = String(req.body?.otp || '').trim();
    if (!svc.PHONE_RE.test(phone)) return res.status(400).json({ error: 'Invalid Indian mobile number' });
    if (!svc.OTP_RE.test(otp)) return res.status(400).json({ error: 'Invalid OTP format' });
    if (!ready(res)) return;
    try { await svc.getLimiters().verifyIp.consume(req.ip || 'unknown'); } catch (rej) { return limitReply(rej, res); }

    const r = await svc.verifyLoginOtp(phone, otp);
    if (!r.ok) {
        if (r.retryAfter) res.set('Retry-After', String(r.retryAfter));
        return res.status(r.status).json({ error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) });
    }
    auditTrail.record({
        actorType: 'superadmin', actorId: r.admin._id, actorLabel: r.admin.email,
        action: 'LOGIN /api/admin/auth/verify-otp', method: 'POST', path: '/api/admin/auth/verify-otp', status: 200, ip: req.ip,
    });
    res.json({ token: signAdminToken(r.admin), admin: { email: r.admin.email, name: r.admin.name || null } });
}));

// Password login: OFF unless SUPERADMIN_PASSWORD_LOGIN=true. Wrong tries per IP are counted in MongoDB.
router.post('/login', wrap(async (req, res) => {
    if (process.env.SUPERADMIN_PASSWORD_LOGIN !== 'true') {
        return res.status(403).json({ error: 'Password login is switched off. Use phone OTP.' });
    }
    if (!ready(res)) return;
    const ip = req.ip || 'unknown';
    const L = svc.getLimiters();
    const used = await L.loginFail.get(ip);
    if (used && used.consumedPoints >= 5) return limitReply({ msBeforeNext: used.msBeforeNext }, res);

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const account = email ? await SuperAdmin.findOne({ email }) : null;
    const ok = account ? await account.verifyPassword(password) : (await SuperAdmin.dummyVerify(password), false);
    if (!ok || !account.isActive) {
        await L.loginFail.consume(ip).catch(() => { });
        return res.status(401).json({ error: 'Wrong email or password' });
    }

    await L.loginFail.delete(ip).catch(() => { });
    account.lastLoginAt = new Date();
    await account.save();
    auditTrail.record({
        actorType: 'superadmin', actorId: account._id, actorLabel: account.email,
        action: 'LOGIN /api/admin/auth/login', method: 'POST', path: '/api/admin/auth/login', status: 200, ip,
    });
    res.json({ token: signAdminToken(account), admin: { email: account.email, name: account.name || null } });
}));

// Change your login phones. Proof needed: a fresh OTP sent to one of your CURRENT phones (use /auth/send-otp first).
me.put('/phones', wrap(async (req, res) => {
    const b = req.body || {};
    const phones = Array.isArray(b.phones) ? [...new Set(b.phones.map((p) => String(p).trim()))] : null;
    if (!phones || !phones.length || phones.length > 2 || !phones.every((p) => svc.PHONE_RE.test(p))) {
        throw httpError(400, 'Send 1 or 2 valid 10-digit mobile numbers');
    }
    const verifyPhone = String(b.verifyPhone || '').trim();
    const otp = String(b.otp || '').trim();
    if (!svc.PHONE_RE.test(verifyPhone) || !svc.OTP_RE.test(otp)) throw httpError(400, 'Send verifyPhone and the 6-digit otp');
    if (!ready(res)) return;
    try { await svc.getLimiters().verifyIp.consume(req.ip || 'unknown'); } catch (rej) { return limitReply(rej, res); }

    const cur = await SuperAdmin.findById(req.admin._id).select('phones').lean();
    if (!cur?.phones?.includes(verifyPhone)) throw httpError(400, 'Verify with one of your current numbers');
    const r = await svc.verifyLoginOtp(verifyPhone, otp);
    if (!r.ok || String(r.admin._id) !== String(req.admin._id)) {
        return res.status(r.status || 400).json({ error: r.error || 'Invalid or expired OTP' });
    }
    if (await SuperAdmin.exists({ _id: { $ne: req.admin._id }, phones: { $in: phones } })) {
        throw httpError(409, 'One of these numbers belongs to another superadmin');
    }

    req.auditBefore = { phones: cur.phones };
    await SuperAdmin.updateOne({ _id: req.admin._id }, { $set: { phones } });
    res.json({ phones });
}));

router.me = me;
module.exports = router;