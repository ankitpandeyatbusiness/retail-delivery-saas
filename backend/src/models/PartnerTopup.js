const mongoose = require('mongoose');

// One Partner wallet top-up. The wallet is credited only by partnerWalletService.completeTopup() once Razorpay says the money is captured.
const partnerTopupSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },   // what the wallet gets
    gstPercent: { type: Number, default: 0 },
    gstPaise: { type: Number, default: 0 },
    payablePaise: Number,                                                       // what the owner pays = amountPaise + gstPaise
    status: { type: String, enum: ['pending', 'paid', 'expired'], default: 'pending' },
    rzpOrderId: String,
    expiresAt: Date,
    paymentId: String,
    paidAt: Date,
    invoice: { type: mongoose.Schema.Types.Mixed },   // the tax invoice / receipt, saved when paid
    createdBy: { type: { type: String }, id: String, label: String },
    paidBy: { type: { type: String }, id: String, label: String },
}, { timestamps: true });

partnerTopupSchema.index({ tenantId: 1, createdAt: -1 });
partnerTopupSchema.index({ rzpOrderId: 1 }, { sparse: true });

module.exports = mongoose.model('PartnerTopup', partnerTopupSchema);
