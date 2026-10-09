const mongoose = require('mongoose');

// One wallet per shop. All money is integer paise. null rate/cost/low = use the platform default.
const smsWalletSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    balancePaise: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    ratePerSmsPaise: { type: Number, default: null },     // selling price per SMS (shop override)
    costPerSmsPaise: { type: Number, default: null },     // your cost per SMS (to see profit)
    lowBalancePaise: { type: Number, default: null },     // warn the owner below this
    blockAtZero: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SmsWallet', smsWalletSchema);