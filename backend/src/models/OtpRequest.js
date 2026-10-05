const mongoose = require('mongoose');

const otpRequestSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    phone: { type: String, required: true },
    otpHash: { type: String, required: true },   // HMAC, never the raw OTP
    attempts: { type: Number, default: 0 },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    ipHash: String,
    deviceId: String,
}, { timestamps: true });

// Mongo deletes the doc once expiresAt passes
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Serves both the verify lookup (sorted by newest) and the updateMany in sendOtp
otpRequestSchema.index({ tenantId: 1, phone: 1, consumed: 1, createdAt: -1 });

module.exports = mongoose.model('OtpRequest', otpRequestSchema);