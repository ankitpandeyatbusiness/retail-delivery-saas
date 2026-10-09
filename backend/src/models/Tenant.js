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
    androidPackage: String,

    // Restaurant details shown in the app
    phone: String,
    address: { line: String, city: String, pincode: String },

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

    ownerBlocked: { type: Boolean, default: false },
    ownerBlockedReason: { type: String, trim: true, maxlength: 200 },   // private note, never sent to the app
    maintenance: {
        on: { type: Boolean, default: false },
        message: { type: String, trim: true, maxlength: 200 },
        until: Date,
    },
    subscription: {
        monthlyFee: { type: Number, min: 0 },                              // 0 or empty = not billed
        gstPercent: { type: Number, min: 0, max: 28 },                     // empty = 18
        startMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },    // "2026-10"
    },

    // Rent engine. null means "use the platform value". Only billing code and the superadmin billing routes write this.
    billing: {
        goLiveAt: Date,                                         // empty = the shop's createdAt
        deliveredCount: { type: Number, default: 0, min: 0 },   // only goes up, never down
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