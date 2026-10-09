const mongoose = require('mongoose');

const smsLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    phoneMasked: String,                                   // 98XXXXXX10
    purpose: { type: String, enum: ['otp', 'bill', 'alert'], required: true },
    chargedPaise: { type: Number, default: 0 },            // what the shop paid
    costPaise: { type: Number, default: 0 },               // what you paid the provider
    status: { type: String, enum: ['sent', 'failed', 'mock'], required: true },
    providerMessageId: String,
    txnId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmsTransaction' },
}, { timestamps: { createdAt: true, updatedAt: false } });

smsLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('SmsLog', smsLogSchema);