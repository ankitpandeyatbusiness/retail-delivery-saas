const mongoose = require('mongoose');

// One QR request for an SMS top-up. The wallet is credited only by smsTopupService.complete().
const smsTopupSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },
    status: { type: String, enum: ['pending', 'paid', 'expired'], default: 'pending' },
    qrId: String,
    upiString: String,
    imageUrl: String,
    expiresAt: Date,
    paymentId: String,       // provider payment id (from the webhook), for records
    paidAt: Date,
    createdBy: { type: { type: String }, id: String, label: String },
    paidBy: { type: { type: String }, id: String, label: String },
}, { timestamps: true });

smsTopupSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('SmsTopup', smsTopupSchema);