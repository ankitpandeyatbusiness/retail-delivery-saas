const mongoose = require('mongoose');

// Ledger. amountPaise is signed: + adds money (topup, refund), - removes money (debit, adjust down).
const smsTransactionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    type: { type: String, enum: ['topup', 'debit', 'refund', 'adjust'], required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },
    balanceAfter: { type: Number, validate: Number.isInteger },
    paymentId: String,                     // unique: makes webhooks and refunds safe to repeat
    purpose: String,                       // for debits: otp, bill, alert
    note: String,
    actor: { type: { type: String }, id: String, label: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

smsTransactionSchema.index({ tenantId: 1, createdAt: -1 });
smsTransactionSchema.index(
    { paymentId: 1 },
    { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } },
);

module.exports = mongoose.model('SmsTransaction', smsTransactionSchema);