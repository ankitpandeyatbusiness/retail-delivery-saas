const mongoose = require('mongoose');

// A customer's spendable points at one shop. Changed only with one atomic update, so two orders at once can never spend the same points.
const loyaltyAccountSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    balance: { type: Number, default: 0, min: 0 },
    lifetime: { type: Number, default: 0 },
}, { timestamps: true });

loyaltyAccountSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('LoyaltyAccount', loyaltyAccountSchema);
