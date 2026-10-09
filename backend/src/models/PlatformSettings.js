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
        freeOrders: { type: Number, default: 100, min: 0 },       // free service ends at this many delivered orders...
        freeMonths: { type: Number, default: 2, min: 0 },         // ...or this many months after go-live, whichever is first
        graceDays: { type: Number, default: 5, min: 0, max: 60 }, // days after a bill is issued before the shop is paused
        // monthly rent by delivered orders in that month. The last tier has upTo: null (open ended)
        tiers: {
            type: [new mongoose.Schema({ upTo: { type: Number, default: null }, fee: { type: Number, required: true, min: 0 } }, { _id: false })],
            default: () => [{ upTo: 305, fee: 3000 }, { upTo: 1005, fee: 6000 }, { upTo: null, fee: 10000 }],
        },
    },
    // SMS wallet prices. All money is integer paise (100 paise = Rs 1).
    sms: {
        ratePerSmsPaise: { type: Number, default: 30, min: 0 },     // selling price per SMS
        costPerSmsPaise: { type: Number, default: 20, min: 0 },     // your cost per SMS
        lowBalancePaise: { type: Number, default: 5000, min: 0 },   // warn the owner below this
        packs: { type: [Number], default: () => [10000, 25000, 50000] },   // top-up packs
        minTopupPaise: { type: Number, default: 10000, min: 100 },
        maxTopupPaise: { type: Number, default: 1000000, min: 100 },
    },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSettings', platformSchema);