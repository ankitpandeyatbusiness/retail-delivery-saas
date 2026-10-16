const mongoose = require('mongoose');

// Every reminder a shop sent to a customer (by hand or by Autopilot). It stops a customer being nudged too often,
// stops the same wording coming twice, and shows "what it brought back".
const nudgeLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, required: true, maxlength: 30 },   // winback_1 | winback_2 | winback_3 | welcome | thanks | mealtime | festival | manual
    by: { type: String, enum: ['autopilot', 'owner'], default: 'autopilot' },
    promo: { type: Boolean, default: true },                 // counts toward the weekly limit (welcome and thanks do not)
    messageIdx: Number,                                      // which library message was used
    orderId: { type: mongoose.Schema.Types.ObjectId },       // welcome / thanks: the order that caused it (once per order)
    couponCode: String,
    title: String,
    body: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

nudgeLogSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
nudgeLogSchema.index({ tenantId: 1, createdAt: -1 });
nudgeLogSchema.index({ tenantId: 1, kind: 1, orderId: 1 }, { unique: true, partialFilterExpression: { orderId: { $exists: true } } });
nudgeLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 86400 });

module.exports = mongoose.model('NudgeLog', nudgeLogSchema);
