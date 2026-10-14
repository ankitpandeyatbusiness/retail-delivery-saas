const mongoose = require('mongoose');
const { validateOptionGroups } = require('../services/optionGroups');

const optionSchema = new mongoose.Schema({
    id: { type: String, required: true },            // short and stable, e.g. "large", "oat-milk"
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },     // EXTRA on top of the item's base price
    isDefault: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
}, { _id: false });

const optionGroupSchema = new mongoose.Schema({
    id: { type: String, required: true },            // e.g. "size", "milk", "extras"
    name: { type: String, required: true, trim: true }, // shown to the customer: "Choose size"
    min: { type: Number, default: 0 },               // 0 = optional, 1 = must choose
    max: { type: Number, default: 1 },               // 1 = pick one, 3 = up to three
    options: [optionSchema],
}, { _id: false });

const productSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    description: String,
    image: String,

    // What the item is (Sweet, Food, Drink...) and how it is sold. The kinds come from config/businessTypes.js.
    itemKind: { type: String, trim: true, lowercase: true, match: /^[a-z_]{2,20}$/ },
    sellBy: { type: String, enum: ['piece', 'weight', 'volume'], default: 'piece' },
    // sellBy weight or volume: price is the price of 1 kg (1 L); the customer picks grams (ml)
    measure: {
        _id: false,
        options: [{ type: Number, min: 10, max: 50000 }],   // quick sizes in g / ml. Empty = the platform's quick sizes
        min: { type: Number, min: 10, max: 50000 },
        max: { type: Number, min: 10, max: 50000 },
        step: { type: Number, min: 1, max: 5000 },
        allowManual: { type: Boolean, default: true },       // may the customer type an amount
    },

    price: { type: Number, required: true, min: 0 },   // base / starting price (per kg or litre when sold by weight / volume)
    mrp: Number,                                        // price before discount

    // Food type flags
    isVeg: { type: Boolean, required: [true, 'Choose veg or non-veg'] },   // no default on purpose
    gstRate: { type: Number, enum: [0, 0.25, 3, 5, 12, 18, 28] },        // empty = use the shop's rate
    isEggless: { type: Boolean, default: false },
    isSugarFree: { type: Boolean, default: false },
    isJain: { type: Boolean, default: false },
    spiceLevel: { type: String, enum: ['none', 'mild', 'medium', 'hot'], default: 'none' },

    // Selling flags
    isBestseller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },   // not "isNew": Mongoose reserves that name
    isGiftPack: { type: Boolean, default: false },
    serves: Number,
    calories: { type: Number, min: 0 },
    prepTimeMin: Number,

    // NEW: what the customer can choose (size, milk, extras, weight...). Replaces the 3 fields below.
    optionGroups: [optionGroupSchema],

    // LEGACY: kept so nothing breaks. Run scripts/migrateOptionGroups.js, then stop using these.
    sizes: [{ _id: false, label: String, price: Number }],
    weightOptions: [{ _id: false, grams: Number, price: Number }],
    addOns: [{ _id: false, name: String, price: Number }],

    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },

    isAvailable: { type: Boolean, default: true },     // temporarily out of stock
    stock: {                                           // optional count. Set only through PATCH /api/shop/products/:id/stock
        enabled: { type: Boolean, default: false },
        qty: { type: Number, default: 0, min: 0 },
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

// Sold by weight or volume: the amount is the quantity, so size, serves and a piece count make no sense
productSchema.pre('validate', function () {
    if (this.sellBy && this.sellBy !== 'piece') {
        this.serves = undefined;
        this.sizes = [];
        this.weightOptions = [];
        if (this.stock) { this.stock.enabled = false; this.stock.qty = 0; }
    } else {
        this.measure = undefined;
    }
});

productSchema.pre('validate', function () {
    if (!this.isModified('optionGroups')) return;
    const errors = validateOptionGroups(this.toObject().optionGroups);
    if (errors.length) {
        const e = new mongoose.Error.ValidationError(this);
        e.message = `Invalid option groups: ${errors.join('; ')}`;
        throw e;
    }
});

productSchema.index({ tenantId: 1, isActive: 1, categoryId: 1, sortOrder: 1 });
productSchema.index({ tenantId: 1, isActive: 1, isBestseller: -1, orderCount: -1 });
productSchema.index({ tenantId: 1, isActive: 1, price: 1 });
productSchema.index({ tenantId: 1, isActive: 1, rating: -1 });

module.exports = mongoose.model('Product', productSchema);