const mongoose = require('mongoose');

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// One single document (_id "main") holding platform-wide switches and YOUR business details
// (the details printed on the monthly subscription invoices you send to shops).
const platformSchema = new mongoose.Schema({
    _id: { type: String, default: 'main' },

    // The progress report shop owners see (services/businessReport.js)
    insights: {
        showMarketplaceCompare: { type: Boolean, default: true },                      // show "what the same orders would cost on a delivery marketplace"
        marketplaceCommissionPct: { type: Number, default: 25, min: 0, max: 60 },      // the commission used for that estimate (an estimate, clearly labelled in the app)
        monthlyReportEmail: { type: Boolean, default: true },
        autopilotEnabled: { type: Boolean, default: true },                            // false = no shop's Autopilot sends anything (a kill switch)                          // the platform sends every shop its monthly report by email
    },

    // The contact card shop owners see under Help & support
    support: {
        phone: { type: String, trim: true, maxlength: 20 },
        whatsapp: { type: String, trim: true, maxlength: 20 },
        email: { type: String, trim: true, lowercase: true, maxlength: 120 },
        hours: { type: String, trim: true, maxlength: 120 },          // e.g. "Mon to Sat, 10 AM to 7 PM"
        replyPromise: { type: String, trim: true, maxlength: 160 },   // e.g. "We reply within 24 hours."
    },

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
        appName: { type: String, trim: true, maxlength: 60 },                       // shown in the mail header when there is no logo
        brandColor: { type: String, trim: true, match: [/^#[0-9a-fA-F]{6}$/, 'Colour must look like #1D4ED8'] },
        logoUrl: { type: String, trim: true, maxlength: 300, match: [/^https:\/\/\S+$/, 'The logo link must start with https://'] },
        phone: { type: String, trim: true, maxlength: 20 },
        sacCode: { type: String, trim: true, maxlength: 10 },            // ask your CA which SAC code applies to your service
        pan: { type: String, trim: true, uppercase: true, validate: { validator: (v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), message: 'PAN must look like ABCDE1234F' } },
        state: { type: String, trim: true, maxlength: 40 },              // the state the business is registered in (decides CGST+SGST or IGST)
        stateCode: { type: String, trim: true, validate: { validator: (v) => !v || /^\d{2}$/.test(v), message: 'State code is 2 digits, like 09' } },
        invoicePrefix: { type: String, trim: true, uppercase: true, maxlength: 4, match: [/^[A-Z0-9]*$/, 'Prefix: up to 4 letters or digits'] },   // BABC/26-27/0001 (at most 16 characters in all, as GST requires). A new prefix starts a new series
        poweredBy: { type: String, trim: true, maxlength: 40 },          // "Powered by ..." in the customer app
        contactPhone: { type: String, trim: true, maxlength: 20 },       // the number its Contact button calls
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
    // The ONE GST for every shop's bills. Set only by the superadmin; a shop charges it only while it has a GST number.
    tax: {
        gstPercent: { type: Number, default: 0, min: 0, max: 28 },
        gstMode: { type: String, enum: ['inclusive', 'exclusive'], default: 'inclusive' },   // included in prices, or added on top
    },
    // live tracking of riders (services/trackingGuard.js). mode: socket = normal, polling = apps poll instead of using sockets, off = no live tracking
    tracking: {
        mode: { type: String, enum: ['socket', 'polling', 'off'], default: 'socket' },
        maxSockets: { type: Number, default: 400, min: 10, max: 5000 },   // new sockets are refused beyond this many at once
        pollSec: { type: Number, default: 15, min: 5, max: 120 },        // how often an app polls in polling mode
        // Google calls per month. Each is kept just under Google's free allowance (India); beyond it the apps use a free source (services/googleBudget.js)
        routeCap: { type: Number, default: 60000, min: 0, max: 1000000 },        // road routes without traffic (the economical stage)
        routeProCap: { type: Number, default: 30000, min: 0, max: 1000000 },     // road routes with traffic (the best stage, first)
        textSearchCap: { type: Number, default: 30000, min: 0, max: 1000000 },   // place search by name (Pro price)
        autocompleteCap: { type: Number, default: 60000, min: 0, max: 1000000 }, // suggestions while typing
        detailsCap: { type: Number, default: 60000, min: 0, max: 1000000 },      // address and point of the picked place
    },
    activeOperatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Operator' },   // the company whose details are in business/payments now (services/operators.js)

    // The common settlement sheet between the two partners (services/settlement.js). Only the supreme admin changes it.
    settlement: {
        ownerName: { type: String, trim: true, maxlength: 40 },          // how the platform owner is named on the sheet
        partnerName: { type: String, trim: true, maxlength: 40 },        // how the operator partner is named
        mode: { type: String, enum: ['split', 'owner_only'], default: 'split' },   // owner_only: after the switch, everything is the owner's
        payDays: { type: Number, default: 15, min: 0, max: 90 },         // the partner pays within this many days of each payment
        ownerPctPartnerBrought: { type: Number, default: 50, min: 0, max: 100 },   // the owner's share of a shop the partner brought
        ownerPctOwnerBrought: { type: Number, default: 70, min: 0, max: 100 },     // ... of a shop the owner brought
        costOwnerPct: { type: Number, default: 50, min: 0, max: 100 },   // the owner's share of shared costs
    },
    // YOUR Razorpay account (receives SMS top-ups and rent). Written only by /api/admin/platform/payments.
    payments: {
        keyId: { type: String, trim: true },
        keySecretEnc: { type: String, select: false },       // encrypted, never sent to any app
        webhookSecretEnc: { type: String, select: false },   // encrypted, shown once when created
        verifiedAt: Date,
        lastWebhookAt: Date,
    },
    // SMS wallet prices. All money is integer paise (100 paise = Rs 1).
    sms: {
        ratePerSmsPaise: { type: Number, default: 30, min: 0 },     // selling price per SMS
        costPerSmsPaise: { type: Number, default: 20, min: 0 },     // your cost per SMS
        lowBalancePaise: { type: Number, default: 5000, min: 0 },   // warn the owner below this
        packs: { type: [Number], default: () => [10000, 25000, 50000] },   // top-up packs
        minTopupPaise: { type: Number, default: 10000, min: 100 },         // the smallest top-up: Rs 100
        gstPercent: { type: Number, default: 18, min: 0, max: 28 },         // GST added on top of an SMS top-up (0 = none)
        maxTopupPaise: { type: Number, default: 1000000, min: 100 },
    },
    // Alerts to the superadmin. smsToAdmin is YOUR global switch for alert SMS to your phone.
    alerts: {
        smsToAdmin: { type: Boolean, default: false },
        allEvents: { type: Boolean, default: false },   // false = SMS only for critical alerts
        phone: { type: String, trim: true, match: [/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'] },
        lastSmsFailAt: Date,   // when "SMS provider failing" was last sent to you
        rrCursor: { type: mongoose.Schema.Types.ObjectId },   // the shop that paid the last alert SMS (round robin)
    },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSettings', platformSchema);