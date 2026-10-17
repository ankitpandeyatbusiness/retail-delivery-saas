const mongoose = require('mongoose');

// One online payment that settles ALL the unpaid bills of a shop at once (rent months and late fees together).
// The Razorpay order is for the sum of the bills listed here, fixed when the payment is started.
const duesPaymentSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    rzpOrderId: { type: String, required: true, unique: true },
    invoiceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionInvoice' }],
    invoiceKey: { type: String, required: true },   // the sorted ids joined: the same bills and amount reuse the same Razorpay order
    amountPaise: { type: Number, required: true, min: 100 },
    status: { type: String, enum: ['created', 'paid'], default: 'created' },
    paymentId: String,
    paidAt: Date,
}, { timestamps: true });

duesPaymentSchema.index({ tenantId: 1, invoiceKey: 1, amountPaise: 1, status: 1 });

module.exports = mongoose.model('DuesPayment', duesPaymentSchema);
