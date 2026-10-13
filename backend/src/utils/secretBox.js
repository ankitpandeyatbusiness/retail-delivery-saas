// AES-256-GCM for secrets kept in the database (per-shop SMS keys, later Razorpay keys).
// Env SECRETS_KEY = 32 random bytes in base64. Stored text: v1:<iv>:<tag>:<data>
const crypto = require('crypto');

const key = () => {
    const raw = process.env.SECRETS_KEY;
    if (!raw) throw new Error('SECRETS_KEY is not set');
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes in base64');
    return k;
};

function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(text) {
    const [v, iv, tag, data] = String(text || '').split(':');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('Bad secret format');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };