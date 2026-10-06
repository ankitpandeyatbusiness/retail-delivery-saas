const jwt = require('jsonwebtoken');

// A DIFFERENT secret from your customer tokens, so a customer token can never pass as an admin token.
const SECRET = process.env.SUPERADMIN_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
    throw new Error('SUPERADMIN_JWT_SECRET must be set in .env (at least 32 random characters)');
}

const ISSUER = 'platform-admin';

const signAdminToken = (admin) =>
    jwt.sign({ sub: String(admin._id), role: 'superadmin' }, SECRET, {
        algorithm: 'HS256',
        issuer: ISSUER,
        expiresIn: '8h',
    });

const verifyAdminToken = (token) => {
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: ISSUER });
    if (decoded.role !== 'superadmin') throw new Error('Not a superadmin token');
    return decoded;
};

module.exports = { signAdminToken, verifyAdminToken };