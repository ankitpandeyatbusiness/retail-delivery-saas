const mongoose = require('mongoose');

// "Did you get your part?" for one shop and one month: a plain record the developer fills in (yes, or no with a reason).
// It stores the amount and the percentage it was answered for: if a payment arrives later, or the shop's "brought by" changes, the answer is asked again.
const shopMoneyCheckSchema = new mongoose.Schema({
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },          // "2026-05" (the month the money was received)
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    got: { type: Boolean, required: true },
    reason: { type: String, trim: true, maxlength: 300 },                                 // asked when got is false
    amount: { type: Number, required: true },                                             // what the shop paid that month, before GST
    pct: { type: Number, required: true },                                                // the developer's percentage then (50 or 70)
    yourPart: { type: Number, required: true },
    by: { id: String, name: String },
    at: { type: Date, default: Date.now },
}, { timestamps: true });

shopMoneyCheckSchema.index({ month: 1, tenantId: 1 }, { unique: true });

module.exports = mongoose.model('ShopMoneyCheck', shopMoneyCheckSchema);
