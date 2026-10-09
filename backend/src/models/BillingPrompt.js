const mongoose = require('mongoose');

// Remembers what the owner chose on a warning ("Pay now" or "Remind me later") and when it may show again.
//   kind "bill" -> refId is the invoice id    kind "sms" -> refId is "sms"
const billingPromptSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, enum: ['bill', 'sms'], required: true },
    refId: { type: String, required: true, maxlength: 60 },
    snoozedUntil: Date,
    lastChoice: { type: String, enum: ['pay_now', 'remind_later'] },
    lastChoiceAt: Date,
}, { timestamps: true });

billingPromptSchema.index({ tenantId: 1, kind: 1, refId: 1 }, { unique: true });
billingPromptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 180 * 86400 });   // old rows delete themselves

module.exports = mongoose.model('BillingPrompt', billingPromptSchema);