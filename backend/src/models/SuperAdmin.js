const mongoose = require('mongoose');
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// Platform-level owner of the SaaS. NOT tied to any tenant (unlike User.role = 'admin').
const superAdminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false }, // "salt:hash" (hex)
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
}, { timestamps: true });

superAdminSchema.methods.setPassword = async function (password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    this.passwordHash = `${salt}:${hash}`;
};

// passwordHash is hidden by default, so we load it only when checking a password
superAdminSchema.methods.verifyPassword = async function (password) {
    const doc = this.passwordHash ? this : await this.constructor.findById(this._id).select('+passwordHash');
    const [salt, hash] = String(doc?.passwordHash || '').split(':');
    if (!salt || !hash) return false;
    const given = await scrypt(password, salt, 64);
    const real = Buffer.from(hash, 'hex');
    return real.length === given.length && crypto.timingSafeEqual(real, given);
};

// Burn the same time when the email doesn't exist, so response time doesn't reveal valid emails
superAdminSchema.statics.dummyVerify = async function (password) {
    await scrypt(password, '00000000000000000000000000000000', 64);
};

module.exports = mongoose.model('SuperAdmin', superAdminSchema);