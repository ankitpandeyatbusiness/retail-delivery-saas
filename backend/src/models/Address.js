const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    label: { type: String, trim: true, maxlength: 20, default: 'Home' },   // Home / Work / Other
    name: { type: String, trim: true, maxlength: 80 },                      // who receives the order
    phone: { type: String, trim: true, match: /^[6-9]\d{9}$/ },
    line1: { type: String, required: true, trim: true, maxlength: 150 },    // flat, building, street
    line2: { type: String, trim: true, maxlength: 150 },
    landmark: { type: String, trim: true, maxlength: 100 },
    city: { type: String, trim: true, maxlength: 60 },
    pincode: { type: String, trim: true, match: /^\d{6}$/ },

    // Needed to check the shop's delivery radius
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },

    isDefault: { type: Boolean, default: false },
}, { timestamps: true });

addressSchema.index({ tenantId: 1, userId: 1, isDefault: -1, createdAt: -1 });

module.exports = mongoose.model('Address', addressSchema);