const mongoose = require('mongoose');
const { hashPhone } = require('../utils/phoneHash');

const userSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    phone: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
    phoneHash: { type: String },   // recognises the same person even after his account is deleted
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    emailVerifiedAt: Date,   // the owner proved the address with a code (services/emailVerifyService.js)
    notes: { type: String, trim: true, maxlength: 300 },   // a private note by the owner or the superadmin. The person never sees it.
    prefs: {
        promotions: { type: Boolean, default: true },   // false = no promotional broadcasts (information messages still arrive)
    },
    role: { type: String, enum: ['customer', 'rider', 'admin'], default: 'customer' },
    isBlocked: { type: Boolean, default: false },
    referralCode: { type: String, trim: true, uppercase: true },   // the code he shares to refer a friend (made the first time he asks)
    language: { type: String, enum: ['en', 'hi', 'bho', 'mr', 'gu', 'bn'] },   // the language this person reads (notifications and emails come in it)
    lastLoginAt: { type: Date },
}, { timestamps: true });

// Same phone can exist once per shop, never twice in the same shop
userSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
userSchema.index({ tenantId: 1, phoneHash: 1 });
userSchema.index({ tenantId: 1, referralCode: 1 }, { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } });

// set the hash on every normal save (upserts set it by hand where they are written)
userSchema.pre('validate', function () {
    if (this.tenantId && /^\d{10}$/.test(String(this.phone || ''))
        && (!this.phoneHash || this.isModified('phone') || this.isModified('tenantId'))) {
        this.phoneHash = hashPhone(this.tenantId, this.phone);
    }
});

// Safety net: never serialize internal fields even if someone does res.json(user)
userSchema.set('toJSON', {
    transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.refreshTokens;
        delete ret.isBlocked;
        delete ret.phoneHash;
        delete ret.notes;
        return ret;
    },
});

module.exports = mongoose.model('User', userSchema);