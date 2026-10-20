const mongoose = require('mongoose');
const { validateOptionGroups } = require('../services/optionGroups');

const optionSchema = new mongoose.Schema({
    id: { type: String, required: true },            // short and stable, e.g. "large", "oat-milk"
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },     // EXTRA on top of the item's base price
    isDefault: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
    unavailableUntil: Date,                          // switched off for a while ("back in 2 h", "sold out today"): it comes back by itself (stockService.sweepSoldOut)
}, { _id: false });

const optionGroupSchema = new mongoose.Schema({
    id: { type: String, required: true },            // e.g. "size", "milk", "extras"
    name: { type: String, required: true, trim: true }, // shown to the customer: "Choose size"
    min: { type: Number, default: 0 },               // 0 = optional, 1 = must choose
    max: { type: Number, default: 1 },               // 1 = pick one, 3 = up to three
    absolute: { type: Boolean, default: false },     // the owner types each option's FULL price (Half 150, Full 280). Stored as base price + extra; this only changes how it is shown
    options: [optionSchema],
}, { _id: false });

const productSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    description: String,
    image: String,
    images: [String],   // up to 4 more pictures of the dish; the customer app slides through image + images

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
    maxPerOrder: { type: Number, min: 1, max: 20, validate: { validator: (v) => v == null || Number.isInteger(v), message: 'maxPerOrder must be a whole number' } },   // the most one order may have of this item (empty = no limit)
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
    // "sold out until ...": the owner switched it off for a while. It switches ON again by itself at this time
    // (stockService.sweepSoldOut, run whenever the menu is read). No date = off until the owner switches it on.
    unavailableUntil: Date,
    stock: {                                           // optional count. Set only through PATCH /api/shop/products/:id/stock
        enabled: { type: Boolean, default: false },    // false = unlimited
        qty: { type: Number, default: 0, min: 0 },     // left right now: pieces, or g / ml for weight / volume items
        dailyQty: { type: Number, min: 0 },            // what every new day starts with (empty = no daily reset)
        resetOn: String,                               // the shop day (YYYY-MM-DD) this count belongs to
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

// Price, "sold out", "back after 2 hours", stock, name, picture: whatever changes a dish, the customers' menus must follow at once.
// The apps are told over the live connection (they reload the menu); several changes within half a second make one message.
const told = new Map();   // tenantId -> timer
function menuChanged(tenantId) {
    const key = tenantId && String(tenantId);
    if (!key || told.has(key)) return;
    told.set(key, setTimeout(() => {
        told.delete(key);
        try { require('../services/realtime').toShop(key, 'menu:changed', {}); } catch (e) { /* the apps also refresh when opened */ }
    }, 500).unref?.() || 0);
}
productSchema.post('save', (doc) => menuChanged(doc?.tenantId));
productSchema.post(['findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace'], (doc) => menuChanged(doc?.tenantId));
// (a sweep that changed nothing, such as the automatic 'back in stock' check on every menu read, says nothing)
productSchema.post(['updateOne', 'updateMany', 'deleteOne', 'deleteMany'], function (res) {
    if (res && (res.modifiedCount === 0 || res.deletedCount === 0 || res.matchedCount === 0)) return;
    menuChanged(this.getFilter?.()?.tenantId);
});

module.exports = mongoose.model('Product', productSchema);