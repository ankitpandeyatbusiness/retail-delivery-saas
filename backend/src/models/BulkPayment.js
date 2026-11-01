const mongoose = require('mongoose');

const { Schema } = mongoose;

// One Razorpay order of a bulk order: the advance now, the balance later (kind). Money rules are the same as for a table booking deposit:
// the server decides the amount, the money is recorded in ONE place (services/bulkPayment.js confirm) and every step is safe to repeat.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bulkId: { type: Schema.Types.ObjectId, ref: 'BulkOrder', required: true },
    kind: { type: String, enum: ['advance', 'balance'], default: 'advance' },
    quoteVersion: { type: Number, required: true },        // the quote this payment is for: a newer quote makes an older payment a late payment
    mode: { type: String, enum: ['test', 'live', 'mock'], default: 'mock' },
    rzpOrderId: { type: String, required: true },
    rzpPaymentId: String,
    amountPaise: { type: Number, required: true, min: 100 },
    status: { type: String, enum: ['created', 'captured'], default: 'created' },
    capturedAt: Date,
    checkedAt: Date,                                        // the repair job last asked Razorpay about it
    settleStartedAt: Date,                                  // the follow-up work (the order becomes confirmed, people are told) was started...
    settledAt: Date,                                        // ...and finished. Captured but not settled = the repair job finishes it
    mismatchRefund: { status: { type: String, enum: ['sending', 'refunded', 'failed'] }, refundId: String, at: Date },   // a payment of the wrong amount goes back (services/mismatchRefund.js)
    // the money going back (cancel, a late payment...). One per payment; `key` is sent to Razorpay so a retry can tell it already went out.
    refund: {
        _id: false,
        status: { type: String, enum: ['sending', 'refunded', 'failed'] },
        reason: String, amountPaise: Number, refundId: String, key: String,
        attempts: { type: Number, default: 0 }, at: Date, lastError: String,
    },
}, { timestamps: true });

schema.index({ rzpOrderId: 1 }, { unique: true });
schema.index({ bulkId: 1, kind: 1, quoteVersion: 1 }, { unique: true, partialFilterExpression: { status: 'created' } });   // one open Razorpay order per quote and kind
schema.index({ status: 1, createdAt: 1 });
schema.index({ 'refund.status': 1, 'refund.at': 1 });

module.exports = mongoose.model('BulkPayment', schema);
