const mongoose = require('mongoose');

// "I agree": who agreed to which version of which document, and when. Never changed, never deleted.
const legalAcceptanceSchema = new mongoose.Schema({
    who: { type: String, enum: ['user', 'admin'], required: true },       // a shop user (owner, rider) or a superadmin
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    docKey: { type: String, required: true },
    version: { type: Number, required: true },
    name: String,
    phone: String,
    operatorName: String,
    acceptedAt: { type: Date, default: Date.now },
}, { timestamps: false });

legalAcceptanceSchema.index({ who: 1, userId: 1, docKey: 1, version: 1 }, { unique: true });
legalAcceptanceSchema.index({ docKey: 1, version: 1 });

module.exports = mongoose.model('LegalAcceptance', legalAcceptanceSchema);
