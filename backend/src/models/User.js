const mongoose = require('mongoose');

// NOTE: I have not seen your original User model. MERGE any extra fields you
// already use (addresses, email, fcmToken, ...) into this schema. The important
// changes are: refreshTokens REMOVED, unique {tenantId, phone} index, role/isBlocked.
const userSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    phone: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    role: { type: String, enum: ['customer', 'rider', 'admin'], default: 'customer' },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
}, { timestamps: true });

// Same phone can exist once per shop, never twice in the same shop
userSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

// Safety net: never serialize internal fields even if someone does res.json(user)
userSchema.set('toJSON', {
    transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.refreshTokens;
        delete ret.isBlocked;
        return ret;
    },
});

module.exports = mongoose.model('User', userSchema);