const mongoose = require('mongoose');

// One line of the points book. Nothing is ever edited: a change is a new line. (services/loyaltyService.js)
//   kind     'customer' (points he can spend) | 'rider' (points that make his badge)
//   reason   customer: order | first | review_food | review_delivery | redeem | return | expire      rider: delivered | stars | fault | cancel_pickup
//   status   customer earnings wait as 'pending' until availableAt (24 hours after delivery), then 'done'. 'void' = taken back before arriving.
//   points   positive = earned, negative = spent / lost
const loyaltyEntrySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['customer', 'rider'], required: true },
    reason: { type: String, required: true },
    points: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'done', 'void'], default: 'done' },
    availableAt: Date,
    expiresAt: Date,
    expired: { type: Boolean, default: false },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderNo: Number,
    note: { type: String, maxlength: 120 },
    stars: Number,   // a rider's line for a customer rating: how many stars
}, { timestamps: true });

// one line per reason per order for one person: a repeated event (a retry, a double tap) can never count twice
loyaltyEntrySchema.index({ tenantId: 1, userId: 1, kind: 1, reason: 1, orderId: 1 }, { unique: true, partialFilterExpression: { orderId: { $exists: true } } });
loyaltyEntrySchema.index({ kind: 1, status: 1, availableAt: 1 });
loyaltyEntrySchema.index({ tenantId: 1, userId: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model('LoyaltyEntry', loyaltyEntrySchema);
