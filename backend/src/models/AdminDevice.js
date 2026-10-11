const mongoose = require('mongoose');

// One phone of a superadmin that can get push messages.
const adminDeviceSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', required: true },
    token: { type: String, required: true, unique: true, maxlength: 4096 },
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

adminDeviceSchema.index({ adminId: 1, lastSeenAt: -1 });
adminDeviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 120 * 86400 });   // a phone not seen for 120 days is forgotten

module.exports = mongoose.model('AdminDevice', adminDeviceSchema);