// Money going back to a customer. The row is saved BEFORE we ask Razorpay, with one fixed key,
// so a retry, a double click or a repeated webhook can never send the money twice.
const mongoose = require('mongoose');

const { Schema } = mongoose;

const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'OnlinePayment', required: true },
    rzpPaymentId: { type: String, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    reason: String,
    complaintId: { type: Schema.Types.ObjectId },
    key: { type: String, required: true },
    status: { type: String, enum: ['pending', 'processing', 'processed', 'failed'], default: 'pending' },
    rzpRefundId: String,
    attempts: { type: Number, default: 0 },
    lastTryAt: Date,
    lockedUntil: Date,
    lastError: String,
    processedAt: Date,
    customerNotifiedAt: Date,   // the customer was told the money is on its way back (once per refund)
    external: { type: Boolean, default: false },   // made from the Razorpay dashboard, not by us
    checkedAt: Date,   // reconcile: last time Razorpay was asked about it
}, { timestamps: true });

schema.index({ key: 1 }, { unique: true });
schema.index({ rzpRefundId: 1 });
schema.index({ paymentId: 1, status: 1 });
schema.index({ status: 1, lastTryAt: 1 });

module.exports = mongoose.model('OnlineRefund', schema);