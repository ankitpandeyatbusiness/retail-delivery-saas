const mongoose = require('mongoose');

// A coupon the platform gives to shops for a NEW plan payment (not the shops' own customer coupons, see Coupon.js).
// Made by the supreme admin. Percentage off only. It is never stacked with the 3 / 6 month discount: the better of the two applies (services/planBilling.js).
const usedSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    paymentId: { type: String, required: true },
    pct: Number,
    at: { type: Date, default: Date.now },
}, { _id: false });

const platformCouponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 20 },
    pct: { type: Number, required: true, min: 1, max: 90 },
    plans: { type: [String], default: ['growth', 'pro'] },          // growth, pro
    months: { type: [Number], default: [] },                         // empty = any term (3 or 6 are the useful ones)
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },                          // the last moment the coupon can be used
    shops: { type: [mongoose.Schema.Types.ObjectId], default: [] },  // empty = every shop that can use it
    maxUses: { type: Number, default: null },                        // null = no limit
    usedCount: { type: Number, default: 0 },
    usedBy: { type: [usedSchema], default: [] },
    active: { type: Boolean, default: true },
    note: { type: String, maxlength: 200 },
    notifiedAt: Date,
    createdBy: String,
}, { timestamps: true });

module.exports = mongoose.models.PlatformCoupon || mongoose.model('PlatformCoupon', platformCouponSchema);
