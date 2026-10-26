const jwt = require('jsonwebtoken');

// A DIFFERENT secret from your customer tokens, so a customer token can never pass as an admin token.
const SECRET = process.env.SUPERADMIN_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
    throw new Error('SUPERADMIN_JWT_SECRET must be set in .env (at least 32 random characters)');
}

const ISSUER = 'platform-admin';
// A login lasts this many days and renews itself while the admin uses the app (a token with less than one day of its time used up is replaced on the next call),
// so a working admin is never thrown out; one who has not opened the app for the whole period logs in again.
const DAYS = Math.min(30, Math.max(1, Number(process.env.SUPERADMIN_TOKEN_DAYS) || 7));

const signAdminToken = (admin) =>
    jwt.sign({ sub: String(admin._id), role: 'superadmin' }, SECRET, {
        algorithm: 'HS256',
        issuer: ISSUER,
        expiresIn: `${DAYS}d`,
    });

const verifyAdminToken = (token) => {
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: ISSUER });
    if (decoded.role !== 'superadmin') throw new Error('Not a superadmin token');
    return decoded;
};

// true when the token has used up more than a day of its time: the caller hands back a fresh one
const needsRenewal = (decoded) => (decoded.exp * 1000 - Date.now()) < (DAYS - 1) * 86400000;

module.exports = { signAdminToken, verifyAdminToken, needsRenewal };