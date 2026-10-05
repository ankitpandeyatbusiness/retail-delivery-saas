const mongoose = require('mongoose');
const O = require('../config/homeOptions');

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

    // NEW: the superadmin's ticks
    homeConfig: homeConfigSchema,

    // NEW: where the shop is and how far it delivers
    delivery: {
        latitude: Number,
        longitude: Number,
        radiusKm: Number,
        minOrder: Number,
    },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);