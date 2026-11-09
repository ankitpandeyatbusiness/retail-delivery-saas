const mongoose = require('mongoose');

// One owner payment for a plan (services/planBilling.js). The quote is stored EXACTLY as the owner saw it; the server recomputes it again when the
// money is captured, and if the plan changed meanwhile the payment is held for the supreme admin instead of being applied blindly.
const planPaymentSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, enum: ['new', 'renew', 'upgrade'], required: true },
    from: String,                                   // the plan held when the owner started
    to: { type: String, enum: ['growth', 'pro'], required: true },
    months: { type: Number, default: 1 },
    quote: { type: mongoose.Schema.Types.Mixed, required: true },   // lines, discount, wallet credit, GST, total, the new dates
    payablePaise: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'paid', 'held', 'expired'], default: 'pending' },
    rzpOrderId: String,
    expiresAt: Date,
    paymentId: String,
    paidAt: Date,
    appliedAt: Date,
    heldWhy: String,
    invoice: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: { type: String }, id: String, label: String },
}, { timestamps: true });

planPaymentSchema.index({ tenantId: 1, createdAt: -1 });
planPaymentSchema.index({ rzpOrderId: 1 }, { sparse: true });
planPaymentSchema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } });   // one captured payment applies once

module.exports = mongoose.model('PlanPayment', planPaymentSchema);
