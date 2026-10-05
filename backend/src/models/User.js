const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    phone: { type: String, required: true },
    role: {
        type: String,
        enum: ['customer', 'rider', 'admin', 'superadmin'],
        default: 'customer'
    },
    // Added to manage active sessions securely across devices
    refreshTokens: [{ type: String }]
}, { timestamps: true });

userSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);