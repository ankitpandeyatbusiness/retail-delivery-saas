const mongoose = require('mongoose');

// A 6-digit code mailed to an address to prove it belongs to the owner who is adding it. Only a hash of the code is kept.
const emailCodeSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true, lowercase: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

emailCodeSchema.index({ userId: 1, createdAt: -1 });
emailCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });   // the rows clean themselves up after a day

module.exports = mongoose.model('EmailCode', emailCodeSchema);
