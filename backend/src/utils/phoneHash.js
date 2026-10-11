// Turns a phone number into a code that cannot be reversed. It is the same for the same shop + phone,
// even after the customer deletes his account, so coupons and strikes cannot be dodged.
const crypto = require('crypto');

const SECRET = process.env.PHONE_HASH_SECRET;
if (!SECRET || SECRET.length < 32) {
    throw new Error('FATAL: PHONE_HASH_SECRET must be set in the environment (at least 32 characters).');
}

function hashPhone(tenantId, phone) {
    // a missing value must never become a "null hash": it would match every old order
    if (!tenantId || !/^\d{10}$/.test(String(phone || ''))) {
        throw new Error('hashPhone needs a shop id and a 10 digit phone');
    }
    return crypto.createHmac('sha256', SECRET).update(`${String(tenantId)}:${phone}`).digest('hex');
}

// 9876543210 -> 98XXXXXX10
const maskPhone = (p) => (/^\d{10}$/.test(String(p || '')) ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : null);

module.exports = { hashPhone, maskPhone };