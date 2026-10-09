const mongoose = require('mongoose');

// Rider profile for a User with role "rider". One per shop. Orders point to the User id (userId).
const riderSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true },     // owner can switch a rider off
    isOnline: { type: Boolean, default: false },    // the rider goes online or offline in the app
    vehicle: { type: { type: String, trim: true, maxlength: 20 }, number: { type: String, trim: true, maxlength: 20 } },
    photo: String,
    lastLocation: { lat: Number, lng: Number, at: Date },
    activeOrderCount: { type: Number, default: 0, min: 0 },   // offered + accepted + picked up
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
}, { timestamps: true });

riderSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
riderSchema.index({ tenantId: 1, isActive: 1, isOnline: 1 });

module.exports = mongoose.model('Rider', riderSchema);