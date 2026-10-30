const mongoose = require('mongoose');

const { Schema } = mongoose;

// A guest pays online, from his phone at the table, what he has ordered so far. One row per Razorpay order we made for it.
// The rounds listed here are marked paid when the money is captured; the visit stays open so he can order more.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    orderIds: [{ type: Schema.Types.ObjectId, ref: 'Order' }],
    scope: { type: String, enum: ['all', 'mine'], default: 'all' },   // all = the whole unpaid bill; mine = only his own rounds (he pays his share and leaves)
    orderKey: { type: String, required: true },       // the rounds, sorted: the same unpaid rounds reuse the same Razorpay order
    table: String,
    mode: { type: String, enum: ['test', 'live', 'mock'], default: 'mock' },
    rzpOrderId: { type: String, required: true },
    rzpPaymentId: String,
    amountPaise: { type: Number, required: true, min: 100 },   // what he pays online
    grossPaise: Number,                                        // the unpaid rounds, before a table booking amount is taken off
    creditPaise: { type: Number, default: 0 },                 // the table booking amount taken off (services/bookingCredit.js)
    status: { type: String, enum: ['created', 'captured'], default: 'created' },
    capturedAt: Date,
}, { timestamps: true });

schema.index({ rzpOrderId: 1 }, { unique: true });
schema.index({ tenantId: 1, userId: 1, status: 1 });

module.exports = mongoose.model('TablePayment', schema);
