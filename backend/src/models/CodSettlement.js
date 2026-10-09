const mongoose = require('mongoose');

// COD cash ledger. Integer paise.
//   collect  (+)  rider took cash from a customer, so he owes the shop
//   handover (-)  rider gave cash to the shop
//   adjust        manual fix by the owner or superadmin
// A rider's balance = sum of amountPaise.
const codSettlementSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    type: { type: String, enum: ['collect', 'handover', 'adjust'], required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },
    note: { type: String, maxlength: 200 },
    actor: { type: { type: String }, id: String, label: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

codSettlementSchema.index({ tenantId: 1, riderId: 1, createdAt: -1 });
// one "collect" row per order, even if the code runs twice
codSettlementSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { type: 'collect' } });

module.exports = mongoose.model('CodSettlement', codSettlementSchema);