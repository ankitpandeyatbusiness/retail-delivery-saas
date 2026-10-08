const crypto = require('crypto');
const mongoose = require('mongoose');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const User = require('../models/User');
const Session = require('../models/Session');
const OtpRequest = require('../models/OtpRequest');
const tokenService = require('../services/tokenService');

/* ------------------------------- config ------------------------------- */
if (!process.env.OTP_PEPPER) {
    throw new Error('FATAL: OTP_PEPPER is missing in environment variables.');
}
if (
    process.env.SMS_MOCK === 'true' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_SMS_MOCK_IN_PROD !== 'true'
) {
    throw new Error('FATAL: SMS_MOCK must not be enabled in production.');
}
if (process.env.SMS_MOCK === 'true' && process.env.NODE_ENV === 'production') {
    console.warn('[WARNING] SMS_MOCK is ON in production. Anyone can log in. Preview only.');
}
const OTP_PEPPER = process.env.OTP_PEPPER;
const SMS_MOCK = process.env.SMS_MOCK === 'true'; // mock mode: send-OTP limits are skipped
const OTP_LENGTH = 6; // keep in sync with the app (LoginScreen OTP_LENGTH)
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_SESSIONS_PER_USER = 5;
const ROTATION_GRACE_MS = 30 * 1000; // retry window after a refresh response is lost
const TENANT_DAILY_SMS_CAP = parseInt(process.env.TENANT_DAILY_SMS_CAP, 10) || 3000;

const PHONE_RE = /^[6-9]\d{9}$/;
const OTP_RE = new RegExp(`^\\d{${OTP_LENGTH}}$`);

/* ------------------------------ rate limiters ------------------------------ */
const limiters = {};
const initLimiters = () => {
    const storeClient = mongoose.connection;
    const make = (points, duration, keyPrefix) =>
        new RateLimiterMongo({ storeClient, points, duration, keyPrefix });

    // send-otp (IP limits are generous: many Indian users share one carrier NAT IP)
    limiters.ipHr = make(100, 60 * 60, 'rl_ip_hr');
    limiters.tenantDay = make(TENANT_DAILY_SMS_CAP, 24 * 60 * 60, 'rl_tenant_day'); // protects client's SMS credits
    limiters.phone30s = make(1, 30, 'rl_phone_30s');
    limiters.phoneHr = make(5, 60 * 60, 'rl_phone_hr');
    limiters.phoneDay = make(10, 24 * 60 * 60, 'rl_phone_day');

    // verify-otp
    limiters.verifyIp = make(300, 60 * 60, 'rl_ver_ip');
    limiters.verifyPhoneLockout = make(10, 30 * 60, 'rl_ver_lockout'); // 10 fails => 30 min lock

    // refresh
    limiters.refreshIp = make(200, 60 * 60, 'rl_refresh_ip');
};

if (mongoose.connection.readyState === 1) initLimiters();
else mongoose.connection.once('open', initLimiters);

/* -------------------------------- helpers -------------------------------- */
const maskPhone = (p) => `${p.slice(0, 2)}******${p.slice(-2)}`;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

const generateOtpHash = (otp, tenantId, phone) =>
    crypto.createHmac('sha256', OTP_PEPPER).update(`${otp}${tenantId}${phone}`).digest('hex');

const toUserDto = (user) => ({
    id: user._id,
    phone: user.phone,
    name: user.name || null,
    role: user.role,
});

const handleRateLimitCatch = (rej, res) => {
    if (rej instanceof Error) {
        console.error('Rate limiter error:', rej.message);
        return res.status(503).json({ error: 'Service unavailable' });
    }
    const retryAfter = Math.max(1, Math.ceil((rej.msBeforeNext || 1000) / 1000)); // seconds
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.', retryAfter });
};

// SMS sending.
// Dev:  put SMS_MOCK=true in your .env to print the OTP in the server console.
// Prod: replace the TODO below with your DLT-approved provider call.
// It MUST throw on failure so the quota refund runs.
const sendSms = async (phone, otp, tenant) => {
    if (process.env.SMS_MOCK === 'true') {
        console.log(`\n[MOCK SMS] OTP ${otp} to ${phone} for ${tenant.name}\n`);
        return;
    }
    // TODO: await smsProvider.send({ to: phone, template: 'OTP', otp });
    throw new Error('SMS provider not configured');
};

const refundSendLimits = async (phoneKey, tenantKey) => {
    await Promise.allSettled([
        limiters.phone30s.reward(phoneKey, 1),
        limiters.phoneHr.reward(phoneKey, 1),
        limiters.phoneDay.reward(phoneKey, 1),
        limiters.tenantDay.reward(tenantKey, 1),
    ]);
};

// Consume send-OTP limits in a safe order. The tenant's daily SMS credit is
// taken LAST so a request rejected by a per-phone limit never burns it.
// If any limiter rejects, points already taken from phone/tenant limiters
// are given back. IP points are never refunded.
const consumeSendLimits = async (ip, phoneKey, tenantKey) => {
    const steps = [
        [limiters.ipHr, ip, false],
        [limiters.phone30s, phoneKey, true],
        [limiters.phoneHr, phoneKey, true],
        [limiters.phoneDay, phoneKey, true],
        [limiters.tenantDay, tenantKey, true],
    ];
    const taken = [];
    try {
        for (const [limiter, key, refundable] of steps) {
            await limiter.consume(key);
            if (refundable) taken.push([limiter, key]);
        }
    } catch (rej) {
        await Promise.allSettled(taken.map(([limiter, key]) => limiter.reward(key, 1)));
        throw rej;
    }
};

const findOrCreateUser = async (tenantId, phone) => {
    const run = () =>
        User.findOneAndUpdate(
            { tenantId, phone },
            { $set: { lastLoginAt: new Date() } },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        );
    try {
        return await run();
    } catch (e) {
        if (e && e.code === 11000) return User.findOne({ tenantId, phone }); // concurrent first login
        throw e;
    }
};

const issueSession = async (user, tenant, req, ip) => {
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({
        userId: user._id,
        tenantId: tenant._id,
        sessionId,
    });

    await Session.create({
        _id: sessionId,
        userId: user._id,
        tenantId: tenant._id,
        refreshTokenHash: tokenService.hashToken(refreshToken),
        deviceId: String(req.headers['x-device-id'] || 'unknown').substring(0, 64),
        userAgent: String(req.headers['user-agent'] || '').substring(0, 200),
        ipHash: sha256(ip),
        expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS),
    });

    // Cap devices: keep newest N, delete older sessions
    const stale = await Session.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .skip(MAX_SESSIONS_PER_USER)
        .select('_id')
        .lean();
    if (stale.length) {
        await Session.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    }

    return { accessToken, refreshToken };
};

// Refresh-token rotation with a grace window.
// 1) Normal: caller holds the CURRENT token -> rotate.
// 2) Grace: caller holds the PREVIOUS token, rotated moments ago (lost
//    response / retry) -> issue a fresh pair; the lost token is superseded.
// Returns 'rotated', 'grace', or null (stale/replayed token).
const rotateSession = async ({ sid, tenantId, oldHash, newHash, now }) => {
    const normal = await Session.findOneAndUpdate(
        {
            _id: sid,
            tenantId,
            refreshTokenHash: oldHash,
            expiresAt: { $gt: now },
        },
        {
            $set: {
                refreshTokenHash: newHash,
                prevRefreshTokenHash: oldHash,
                rotatedAt: now,
                lastUsedAt: now,
                expiresAt: new Date(now.getTime() + tokenService.REFRESH_TTL_MS),
            },
        },
        { returnDocument: 'after' }
    );
    if (normal) return 'rotated';

    const grace = await Session.findOneAndUpdate(
        {
            _id: sid,
            tenantId,
            prevRefreshTokenHash: oldHash,
            rotatedAt: { $gt: new Date(now.getTime() - ROTATION_GRACE_MS) },
            expiresAt: { $gt: now },
        },
        // Pipeline update: the token that is current right now becomes "previous", so the
        // token the app may have received from the first request still works for 30 seconds.
        [
            {
                $set: {
                    prevRefreshTokenHash: '$refreshTokenHash',
                    refreshTokenHash: newHash,
                    rotatedAt: now,
                    lastUsedAt: now,
                },
            },
        ],
        { returnDocument: 'after' }
    );
    if (grace) return 'grace';
    return null;
};

/* --------------------------------- send OTP --------------------------------- */
exports.sendOtp = async (req, res) => {
    if (!limiters.ipHr) {
        return res.status(503).json({ error: 'Service unavailable' });
    }

    const phone = String(req.body?.phone || '').trim();
    if (!PHONE_RE.test(phone)) {
        return res.status(400).json({ error: 'Invalid Indian mobile number' });
    }

    const tenant = req.tenant;
    const ip = req.ip || 'unknown';
    const deviceId = String(req.headers['x-device-id'] || 'unknown').substring(0, 64);
    const phoneKey = `${tenant._id}-${phone}`;
    const tenantKey = String(tenant._id);

    if (!SMS_MOCK) {
        try {
            await consumeSendLimits(ip, phoneKey, tenantKey);
        } catch (rej) {
            return handleRateLimitCatch(rej, res);
        }
    }

    try {
        await OtpRequest.updateMany(
            { tenantId: tenant._id, phone, consumed: false },
            { $set: { consumed: true } }
        );

        const otp = crypto
            .randomInt(Math.pow(10, OTP_LENGTH - 1), Math.pow(10, OTP_LENGTH))
            .toString();

        const otpDoc = await OtpRequest.create({
            tenantId: tenant._id,
            phone,
            otpHash: generateOtpHash(otp, tenant._id.toString(), phone),
            expiresAt: new Date(Date.now() + OTP_TTL_MS),
            ipHash: sha256(ip),
            deviceId,
        });

        try {
            await sendSms(phone, otp, tenant);
        } catch (smsErr) {
            console.error(`SMS failed for ${maskPhone(phone)}:`, smsErr.message);
            await OtpRequest.updateOne({ _id: otpDoc._id }, { $set: { consumed: true } });
            await refundSendLimits(phoneKey, tenantKey); // provider failure must not punish the user
            return res.status(503).json({ error: 'Could not send OTP. Please try again.' });
        }

        return res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Send OTP error:', error.message);
        return res.status(500).json({ error: 'Failed to send OTP' });
    }
};

/* --------------------------------- verify OTP --------------------------------- */
exports.verifyOtp = async (req, res) => {
    if (!limiters.verifyIp) {
        return res.status(503).json({ error: 'Service unavailable' });
    }

    const phone = String(req.body?.phone || '').trim();
    const otp = String(req.body?.otp || '').trim();
    if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'Invalid Indian mobile number' });
    if (!OTP_RE.test(otp)) return res.status(400).json({ error: 'Invalid OTP format' });

    const tenant = req.tenant;
    const ip = req.ip || 'unknown';
    const phoneKey = `${tenant._id}-${phone}`;

    try {
        await limiters.verifyIp.consume(ip);
    } catch (rej) {
        return handleRateLimitCatch(rej, res);
    }

    try {
        // Atomically count this attempt against the latest active OTP
        const otpRecord = await OtpRequest.findOneAndUpdate(
            { tenantId: tenant._id, phone, consumed: false, expiresAt: { $gt: new Date() } },
            { $inc: { attempts: 1 } },
            { returnDocument: 'after', sort: { createdAt: -1 } }
        );
        if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });

        if (otpRecord.attempts > MAX_OTP_ATTEMPTS) {
            await OtpRequest.updateOne({ _id: otpRecord._id }, { $set: { consumed: true } });
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const inputHash = Buffer.from(generateOtpHash(otp, tenant._id.toString(), phone), 'hex');
        const storedHash = Buffer.from(otpRecord.otpHash, 'hex');
        const match = inputHash.length === storedHash.length && crypto.timingSafeEqual(inputHash, storedHash);

        if (!match) {
            if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
                await OtpRequest.updateOne({ _id: otpRecord._id }, { $set: { consumed: true } });
            }
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // Single-use, atomic: only ONE parallel request can win this
        const claimed = await OtpRequest.findOneAndUpdate(
            { _id: otpRecord._id, consumed: false },
            { $set: { consumed: true } }
        );
        if (!claimed) return res.status(400).json({ error: 'Invalid or expired OTP' });


        const user = await findOrCreateUser(tenant._id, phone);
        if (!user || user.isBlocked) {
            return res.status(403).json({ error: 'This account cannot sign in' });
        }

        const { accessToken, refreshToken } = await issueSession(user, tenant, req, ip);

        return res.json({ success: true, user: toUserDto(user), accessToken, refreshToken });
    } catch (error) {
        console.error('Verify OTP error:', error.message);
        return res.status(500).json({ error: 'Failed to verify OTP' });
    }
};

/* --------------------------------- refresh --------------------------------- */
exports.refreshToken = async (req, res) => {
    if (!limiters.refreshIp) {
        return res.status(503).json({ error: 'Service unavailable' });
    }

    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 2048) {
        return res.status(401).json({ error: 'Refresh token required' });
    }

    try {
        await limiters.refreshIp.consume(req.ip || 'unknown');
    } catch (rej) {
        return handleRateLimitCatch(rej, res);
    }

    let decoded;
    try {
        decoded = tokenService.verifyRefreshToken(refreshToken);
    } catch (e) {
        return res.status(403).json({ error: 'Invalid refresh token' });
    }

    // Token must belong to the tenant making this request
    if (String(decoded.tid) !== String(req.tenant._id)) {
        return res.status(403).json({ error: 'Invalid refresh token' });
    }

    try {
        const now = new Date();
        const oldHash = tokenService.hashToken(refreshToken);
        const newRefreshToken = tokenService.generateRefreshToken({
            userId: decoded.sub,
            tenantId: decoded.tid,
            sessionId: decoded.sid,
        });

        const outcome = await rotateSession({
            sid: decoded.sid,
            tenantId: req.tenant._id,
            oldHash,
            newHash: tokenService.hashToken(newRefreshToken),
            now,
        });

        if (!outcome) {
            // Not the current token, and not the previous one within the grace
            // window => stale/replayed token. Treat as theft: kill the session.
            await Session.deleteOne({ _id: decoded.sid, tenantId: req.tenant._id });
            return res.status(403).json({ error: 'Invalid or revoked refresh token' });
        }

        const user = await User.findOne({ _id: decoded.sub, tenantId: req.tenant._id }).select('isBlocked');
        if (!user || user.isBlocked) {
            await Session.deleteOne({ _id: decoded.sid });
            return res.status(403).json({ error: 'Invalid or revoked refresh token' });
        }

        const accessToken = tokenService.generateAccessToken({
            userId: decoded.sub,
            tenantId: decoded.tid,
            sessionId: decoded.sid,
        });

        return res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        console.error('Refresh error:', error.message);
        // 500 (not 403) so a temporary DB problem does not log the user out on the client
        return res.status(500).json({ error: 'Could not refresh session' });
    }
};

/* ---------------------------------- logout ---------------------------------- */
// Idempotent: always succeeds, even with an expired/invalid token.
exports.logout = async (req, res) => {
    try {
        const refreshToken = req.body?.refreshToken;
        if (typeof refreshToken === 'string' && refreshToken.length <= 2048) {
            const decoded = tokenService.verifyRefreshToken(refreshToken);
            if (String(decoded.tid) === String(req.tenant._id)) {
                await Session.deleteOne({ _id: decoded.sid, tenantId: req.tenant._id });
            }
        }
    } catch (e) {
        // ignore: nothing to revoke
    }
    return res.json({ success: true, message: 'Logged out successfully' });
};