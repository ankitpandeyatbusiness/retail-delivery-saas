const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error('FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set.');
}
if (ACCESS_SECRET === REFRESH_SECRET) {
    throw new Error('FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
}

const ISSUER = process.env.JWT_ISSUER || 'vivyaan-delivery-api';
const AUDIENCE = process.env.JWT_AUDIENCE || 'vivyaan-delivery-app';

const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
const parseDuration = (value, fallbackMs) => {
    const m = /^(\d+)([smhd])$/.exec(String(value || '').trim());
    return m ? Number(m[1]) * UNIT_MS[m[2]] : fallbackMs;
};

const ACCESS_TTL_MS = parseDuration(process.env.ACCESS_TOKEN_EXPIRY, 15 * UNIT_MS.m);
const REFRESH_TTL_MS = parseDuration(process.env.REFRESH_TOKEN_EXPIRY, 30 * UNIT_MS.d);

const baseOptions = (userId, ttlMs) => ({
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: String(userId),
    jwtid: crypto.randomUUID(),
    expiresIn: Math.floor(ttlMs / 1000),
});

const verifyOptions = { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE };

class TokenService {
    constructor() {
        this.ACCESS_TTL_MS = ACCESS_TTL_MS;
        this.REFRESH_TTL_MS = REFRESH_TTL_MS;
    }

    generateAccessToken({ userId, tenantId, sessionId }) {
        return jwt.sign(
            { tid: String(tenantId), sid: String(sessionId) },
            ACCESS_SECRET,
            baseOptions(userId, ACCESS_TTL_MS)
        );
    }

    generateRefreshToken({ userId, tenantId, sessionId }) {
        return jwt.sign(
            { tid: String(tenantId), sid: String(sessionId) },
            REFRESH_SECRET,
            baseOptions(userId, REFRESH_TTL_MS)
        );
    }

    generateTokens({ userId, tenantId, sessionId }) {
        return {
            accessToken: this.generateAccessToken({ userId, tenantId, sessionId }),
            refreshToken: this.generateRefreshToken({ userId, tenantId, sessionId }),
        };
    }

    verifyAccessToken(token) {
        return jwt.verify(token, ACCESS_SECRET, verifyOptions);
    }

    verifyRefreshToken(token) {
        return jwt.verify(token, REFRESH_SECRET, verifyOptions);
    }

    // Refresh tokens are stored hashed, so a DB leak does not leak usable tokens.
    hashToken(token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }
}

module.exports = new TokenService();