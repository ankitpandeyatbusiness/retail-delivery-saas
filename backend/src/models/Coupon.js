const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    discountType: { type: String, enum: ['percent', 'flat'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscount: Number,                // cap for percent coupons
    minOrder: { type: Number, default: 0 },
    firstOrderOnly: { type: Boolean, default: false },
    usageLimitPerUser: { type: Number, default: 1 },
    totalUsageLimit: Number,
    usedCount: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: true },   // shown in the offers strip
    startsAt: Date,
    endsAt: Date,
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

couponSchema.index(
    { tenantId: 1, code: 1 },
    { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('Coupon', couponSchema);