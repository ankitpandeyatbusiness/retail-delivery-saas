const mongoose = require('mongoose');

// One login OTP for a superadmin phone. Only a hash is stored. The row deletes itself an hour after it expires.
const adminOtpSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', required: true },
    phone: { type: String, required: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    ipHash: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

adminOtpSchema.index({ phone: 1, consumed: 1, createdAt: -1 });
adminOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('AdminOtp', adminOtpSchema);