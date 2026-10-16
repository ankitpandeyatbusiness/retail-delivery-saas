const mongoose = require('mongoose');
const O = require('../config/homeOptions');
const { validateSettings } = require('../services/tenantConfigService');

const homeConfigSchema = new mongoose.Schema({
    shopType: { type: String, enum: O.SHOP_TYPES },
    foodMode: { type: String, enum: O.FOOD_MODES },
    blocks: [{
        _id: false,
        type: { type: String, enum: O.BLOCK_TYPES },
        enabled: { type: Boolean, default: true },
    }],
    filters: [{ type: String, enum: O.FILTER_IDS }],
    sortOptions: [{ type: String, enum: O.SORT_IDS }],
    cardStyle: { type: String, enum: O.CARD_STYLES },
    itemOptions: {
        sizes: Boolean,
        addOns: Boolean,
        spiceLevel: Boolean,
        weightOptions: Boolean,
    },
}, { _id: false });

const tenantSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    tagline: String,
    logo: String,
    colors: {
        primary: String,
        primaryLight: String,
        primaryDark: String,
        background: String,
        text: String,
        error: String,
    },
    heroImages: [String],
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    // what kind of business this is (config/businessTypes.js). Only restaurant is open today.
    businessType: { type: String, enum: ['restaurant', 'general_store', 'stationery', 'garments'], default: 'restaurant' },
    androidPackage: String,

    // Restaurant details shown in the app
    phone: String,
    // state: an Indian state (decides CGST+SGST or IGST on the platform's bills). Free text is refused so a typo cannot change the tax.
    address: { line: String, city: String, state: { type: String, validate: { validator: (v) => !v || !!require('../services/gstSplit').codeFromName(v), message: 'Enter an Indian state name, like Uttar Pradesh' } }, pincode: String },

    // OLD config, still read so existing tenants keep working
    homeConfig: homeConfigSchema,

    delivery: {
        latitude: Number,
        longitude: Number,
        radiusKm: Number,
        minOrder: Number,
    },
    business: {
        legalName: String,
        gstin: {
            type: String, trim: true, uppercase: true,
            validate: {
                validator: (v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v),
                message: 'GST number must be 15 characters, like 22AAAAA0000A1Z5'
            },
        },
        fssai: {
            type: String, trim: true,
            validate: { validator: (v) => !v || /^\d{14}$/.test(v), message: 'FSSAI number must be 14 digits' },
        },
    },

    // Bills and money mails go here. Empty = to the emails of the shop owners.
    contact: {
        billingEmail: {
            type: String, trim: true, lowercase: true, maxlength: 120,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address'],
        },
    },

    // who brought this shop to the platform: decides the revenue split on the settlement sheet. Only the supreme admin sets it.
    broughtBy: { type: String, enum: ['owner', 'partner'] },
    broughtBySetAt: Date,
    // the day the supreme admin handed the app to this shop's owner: from then on the owner and riders are asked to agree to the terms
    handedOverAt: Date,
    handedOverBy: String,

    ownerBlocked: { type: Boolean, default: false },
    ownerBlockedReason: { type: String, trim: true, maxlength: 200 },   // private note, never sent to the app
    maintenance: {
        on: { type: Boolean, default: false },
        message: { type: String, trim: true, maxlength: 200 },
        until: Date,
    },
    subscription: {
        monthlyFee: { type: Number, min: 0 },                              // DEPRECATED: billing does not use this, and the panel cannot set it any more
        gstPercent: { type: Number, min: 0, max: 28 },                     // empty = 18
        startMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },    // "2026-10"
    },

    // Rent engine. null means "use the platform value". Only billing code and the superadmin billing routes write this.
    billing: {
        goLiveAt: Date,                                         // empty = the shop's createdAt
        deliveredCount: { type: Number, default: 0, min: 0 },   // DEPRECATED: replaced by billableCount (kept so no old data is lost)
        billableCount: { type: Number, default: 0, min: 0 },    // orders that earned money for the shop since go-live. Only goes up.
        isLive: { type: Boolean, default: false },              // set by the Go live button. Before that the shop is free and nothing is counted.
        inactiveAlertedAt: Date,                                // "no order for 14 days" was told to the superadmin at this time
        freeOrdersOverride: { type: Number, min: 0, default: null },
        freeMonthsOverride: { type: Number, min: 0, default: null },
        tiersOverride: {
            type: [new mongoose.Schema({ upTo: { type: Number, default: null }, fee: { type: Number, required: true, min: 0 } }, { _id: false })],
            default: undefined,
        },
        fixedFeeOverride: { type: Number, min: 0, default: null },
        state: { type: String, enum: ['free', 'active', 'grace', 'paused'], default: 'free' },
        graceEndsAt: Date,
        freeEndedAt: Date,
    },

    // NEW: every superadmin choice (brand, tabs, home, features, menu, orders, hours, offers, labels).
    // Stored as plain JSON; the validator below is the schema.
    // numbers worked out by the server (never edited by hand)
    stats: { rating: { avg: Number, count: Number } },

    // N14: SMS sender. templateId replaces the platform default template.
    // own: the shop uses its own DLT sender and provider account; its SMS wallet is not charged.
    sms: {
        templateId: { type: String, trim: true },
        own: {
            enabled: { type: Boolean, default: false },
            senderId: { type: String, trim: true },
            entityId: { type: String, trim: true },
            templateIds: { type: Map, of: String },
            providerKeysEnc: { type: String, select: false },     // encrypted, never sent to any app
        },
    },

    // Online payments with the shop's OWN Razorpay account. Set only by the superadmin routes.
    payments: {
        enabled: { type: Boolean, default: false },
        keyId: { type: String, trim: true },
        keySecretEnc: { type: String, select: false },       // encrypted, never sent to any app
        webhookSecretEnc: { type: String, select: false },   // encrypted, shown once when created
        verifiedAt: Date,                                    // the last successful "test connection"
        lastWebhookAt: Date,                                 // the last webhook that passed the signature check
    },

    // Free notes for the developer (superadmin only, never sent to any app). See routes/adminDevRouter.js
    devNotes: { type: String, maxlength: 4000, default: '' },

    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });

// Reject a bad settings document at save time, with readable messages for the panel
tenantSchema.pre('validate', function () {
    if (!this.isModified('settings')) return;
    const { ok, errors } = validateSettings(this.settings);
    if (!ok) {
        const e = new mongoose.Error.ValidationError(this);
        e.message = `Invalid settings: ${errors.join('; ')}`;
        e.settingsErrors = errors;
        throw e;
    }
});

module.exports = mongoose.model('Tenant', tenantSchema);