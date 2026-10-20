const mongoose = require('mongoose');

const { Schema } = mongoose;

// A customer pays online the bill he left unpaid at a table. One row per Razorpay order we made for it.
// (A normal order's online payment is OnlinePayment; this is the same idea for a debt that is not one order but a few table visits.)
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionIds: [{ type: Schema.Types.ObjectId, ref: 'TableSession' }],
    sessionKey: { type: String, required: true },     // the owed visits, sorted: the same debt reuses the same Razorpay order
    mode: { type: String, enum: ['test', 'live', 'mock'], default: 'mock' },
    rzpOrderId: { type: String, required: true },
    rzpPaymentId: String,
    amountPaise: { type: Number, required: true, min: 100 },
    status: { type: String, enum: ['created', 'captured'], default: 'created' },
    capturedAt: Date,
}, { timestamps: true });

schema.index({ rzpOrderId: 1 }, { unique: true });
schema.index({ tenantId: 1, userId: 1, status: 1 });

module.exports = mongoose.model('OwedPayment', schema);
