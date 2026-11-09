const mongoose = require('mongoose');

// The Partner plan's prepaid wallet (services/partnerWalletService.js). One per shop, closed loop: money goes in by top-up, out only as per-order fees.
// All money is integer paise. The balance may go a little below zero (the overdraft, recovered at the next top-up), so there is no min.
const partnerWalletSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    balancePaise: { type: Number, default: 0, validate: Number.isInteger },
    lastTopupPaise: { type: Number, default: 0 },    // the warning ("low") is 20% of this
    lowAlertedAt: Date, zeroAlertedAt: Date,         // so the owner is told once per dip (phase 6 pushes)
}, { timestamps: true });

module.exports = mongoose.model('PartnerWallet', partnerWalletSchema);
