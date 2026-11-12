const mongoose = require('mongoose');

// One document per logged-in device. Replaces User.refreshTokens[].
const sessionSchema = new mongoose.Schema({
    // View-only session (a brand owner looking at another branch when no branch of the brand has multi-branch, Pro): the server refuses every change on it.
    viewOnly: { type: Boolean, default: undefined },
    demo: { type: Boolean, default: undefined },   // opened with the private demo login: the server refuses every real order, payment and message (middlewares/demoGuard.js)
    demoHomeTenantId: { type: mongoose.Schema.Types.ObjectId },   // a demo session: the shop where the demo started (the Customer panel is shown there; the other panels run in the demo shop)
    homeTenantId: { type: mongoose.Schema.Types.ObjectId },   // the branch this owner really works in; switching back to it gives a full session
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
    // for the "Where you're logged in" list (services/clientInfo.js). The IP address itself is never kept.
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    deviceLabel: { type: String },                  // "Chrome on Windows", "Android app"
    city: { type: String }, region: { type: String }, country: { type: String },
    place: { type: String },                        // "Local network" when the address is not on the internet
    lastUsedAt: { type: Date, default: Date.now },

    expiresAt: { type: Date, required: true },
}, { timestamps: true });

// TTL: Mongo removes expired sessions automatically
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Session cap per user (find newest N, delete the rest)
sessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);