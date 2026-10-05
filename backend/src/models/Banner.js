const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    title: String,
    subtitle: String,
    image: String,
    couponCode: String,                 // e.g. FIRST50, shown on the banner
    firstOrderOnly: { type: Boolean, default: false },
    startsAt: Date,
    endsAt: Date,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

bannerSchema.index({ tenantId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Banner', bannerSchema);