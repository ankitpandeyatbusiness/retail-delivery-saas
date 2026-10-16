const mongoose = require('mongoose');

const { Schema } = mongoose;

// A company that can run the platform: its name, GST number, state, invoice prefix, payment-gateway keys and "Powered by" line.
// Two of them exist at first (the operator partner's company, then the owner's own agency). One is ACTIVE: its details are copied
// into PlatformSettings (business + payments), which is what invoices, mails and payments read. "Switch operator" does that copy.
const operatorSchema = new Schema({
    label: { type: String, required: true, trim: true, maxlength: 80 },
    business: {
        legalName: { type: String, trim: true, maxlength: 120 },
        address: { type: String, trim: true, maxlength: 250 },
        gstin: { type: String, trim: true, uppercase: true },
        pan: { type: String, trim: true, uppercase: true },
        state: { type: String, trim: true, maxlength: 40 },
        stateCode: { type: String, trim: true },
        sacCode: { type: String, trim: true, maxlength: 10 },
        invoicePrefix: { type: String, trim: true, uppercase: true, maxlength: 12 },
        poweredBy: { type: String, trim: true, maxlength: 40 },
        contactPhone: { type: String, trim: true, maxlength: 20 },
        email: { type: String, trim: true, lowercase: true, maxlength: 120 },
        phone: { type: String, trim: true, maxlength: 20 },
        paymentInstructions: { type: String, trim: true, maxlength: 500 },
        appName: { type: String, trim: true, maxlength: 60 },
        brandColor: { type: String, trim: true },
        logoUrl: { type: String, trim: true, maxlength: 300 },
    },
    // this company's Razorpay account (secrets encrypted exactly like PlatformSettings.payments; never sent to any app)
    payments: {
        keyId: String,
        keySecretEnc: { type: String, select: false },
        webhookSecretEnc: { type: String, select: false },
    },
    settlementMode: { type: String, enum: ['split', 'owner_only'], default: 'split' },   // owner_only: everything it receives is the owner's
    notes: { type: String, trim: true, maxlength: 300 },
    createdBy: String,
}, { timestamps: true });

module.exports = mongoose.model('Operator', operatorSchema);
