const mongoose = require('mongoose');

// One row per shop + phone (by hash). It outlives the customer's account.
// strikes and codBlocked are used by the Cash on delivery rules in a later batch.
const customerRiskSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    phoneHash: { type: String, required: true },
    strikes: { type: Number, default: 0, min: 0 },
    codBlocked: { type: Boolean, default: false },
    codBlockedAt: Date,
    deletedAt: Date,                       // the customer deleted his account
    note: { type: String, maxlength: 200 },
}, { timestamps: true });

customerRiskSchema.index({ tenantId: 1, phoneHash: 1 }, { unique: true });

module.exports = mongoose.model('CustomerRisk', customerRiskSchema);