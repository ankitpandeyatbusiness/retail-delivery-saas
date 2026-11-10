const mongoose = require('mongoose');

// A bank dispute (chargeback) on a payment a SHOP made to the platform: a plan payment, a Partner wallet top-up or an SMS top-up.
// (Disputes on customers' order payments are PaymentDispute.) services/platformDisputes.js writes it from the payment partner's webhook.
const platformDisputeSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, enum: ['plan', 'wallet', 'sms'], required: true },
    sourceId: { type: String, required: true },             // the PlanPayment / PartnerTopup / SmsTopup
    rzpPaymentId: String,
    rzpDisputeId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['created', 'under_review', 'action_required', 'won', 'lost', 'closed'], required: true },
    amountPaise: { type: Number, default: 0 },
    reasonCode: String,
    respondBy: Date,
    history: [{ status: String, at: Date, _id: false }],
    clawedBack: { type: Boolean, default: false },
    settledBy: String,                                       // the supreme admin who closed it by hand (the bank notice never came)
    settledNote: String,           // a lost dispute: the service was taken back
}, { timestamps: true });

platformDisputeSchema.index({ kind: 1, sourceId: 1 });

module.exports = mongoose.models.PlatformDispute || mongoose.model('PlatformDispute', platformDisputeSchema);
