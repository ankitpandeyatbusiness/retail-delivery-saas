const mongoose = require('mongoose');

// One document per logged-in device. Replaces User.refreshTokens[].
const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

    // sha256 of the CURRENT refresh token (never the raw token)
    refreshTokenHash: { type: String, required: true },
    // sha256 of the previous token, used to tell a harmless retry from token theft
    prevRefreshTokenHash: { type: String },
    rotatedAt: { type: Date },

    deviceId: { type: String },
    userAgent: { type: String },
    ipHash: { type: String },
    lastUsedAt: { type: Date, default: Date.now },

    expiresAt: { type: Date, required: true },
}, { timestamps: true });

// TTL: Mongo removes expired sessions automatically
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Session cap per user (find newest N, delete the rest)
sessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);