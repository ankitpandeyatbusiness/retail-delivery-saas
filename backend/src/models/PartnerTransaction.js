const mongoose = require('mongoose');

// The Partner wallet ledger. amountPaise is signed: + topup / reverse / adjust up, - fee / adjust down.
// Unique keys make every step safe to repeat: one fee row per order, one row per payment, one reversal per fee.
const partnerTransactionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    type: { type: String, enum: ['topup', 'fee', 'reverse', 'adjust', 'plan_credit'], required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },
    balanceAfter: { type: Number, validate: Number.isInteger },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderNo: Number,
    baseRs: Number,            // the order value the fee was worked out from (fixed at checkout)
    paymentId: String,         // topups: "ptopup:<topupId>"; unique
    note: String,
    actor: { type: { type: String }, id: String, label: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

partnerTransactionSchema.index({ tenantId: 1, createdAt: -1 });
partnerTransactionSchema.index({ orderId: 1, type: 1 }, { unique: true, partialFilterExpression: { orderId: { $exists: true }, type: { $in: ['fee', 'reverse'] } } });   // one fee and one reversal per order
partnerTransactionSchema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } });

module.exports = mongoose.model('PartnerTransaction', partnerTransactionSchema);
