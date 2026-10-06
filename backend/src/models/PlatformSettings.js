const mongoose = require('mongoose');

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// One single document (_id "main") holding platform-wide switches and YOUR business details
// (the details printed on the monthly subscription invoices you send to shops).
const platformSchema = new mongoose.Schema({
    _id: { type: String, default: 'main' },

    // Maintenance for ALL shops at once. The superadmin side keeps working.
    maintenance: {
        on: { type: Boolean, default: false },
        message: { type: String, trim: true, maxlength: 200 },
        until: Date,   // optional: maintenance ends by itself at this time
    },

    business: {
        legalName: { type: String, trim: true, maxlength: 120 },
        address: { type: String, trim: true, maxlength: 250 },
        gstin: {
            type: String, trim: true, uppercase: true,
            validate: { validator: (v) => !v || GSTIN_RE.test(v), message: 'GST number must be 15 characters, like 22AAAAA0000A1Z5' },
        },
        email: { type: String, trim: true, lowercase: true, maxlength: 120 },
        phone: { type: String, trim: true, maxlength: 20 },
        sacCode: { type: String, trim: true, maxlength: 10 },            // ask your CA which SAC code applies to your service
        paymentInstructions: { type: String, trim: true, maxlength: 500 }, // e.g. UPI id or bank details, printed on pending invoices
    },

    billing: {
        dueDays: { type: Number, default: 7, min: 0, max: 60 },   // days between issue date and due date
    },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSettings', platformSchema);