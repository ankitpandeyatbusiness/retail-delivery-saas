// One row per online order: the Razorpay order we made for it and the money that came in.
// refundedPaise = money reserved or sent back so far. It can never go above capturedPaise (checked in one atomic update).
const mongoose = require('mongoose');

const { Schema } = mongoose;

const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    mode: { type: String, enum: ['test', 'live', 'mock'], default: 'mock' },
    rzpOrderId: { type: String, required: true },
    rzpPaymentId: String,
    amountPaise: { type: Number, required: true, min: 100 },
    status: { type: String, enum: ['created', 'captured', 'mismatch'], default: 'created' },
    capturedPaise: { type: Number, default: 0 },
    refundedPaise: { type: Number, default: 0 },
    refundIds: [{ type: Schema.Types.ObjectId }],
    capturedAt: Date,
    method: String,
    source: String,   // app, webhook or reconcile: who confirmed it first
    nextCheckAt: Date,   // reconcile: when Razorpay is asked about this payment again
    lastFailure: { _id: false, at: Date, reason: String },
}, { timestamps: true });

schema.index({ orderId: 1 }, { unique: true });
schema.index({ rzpOrderId: 1 }, { unique: true });
schema.index({ rzpPaymentId: 1 }, { unique: true, partialFilterExpression: { rzpPaymentId: { $type: 'string' } } });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('OnlinePayment', schema);