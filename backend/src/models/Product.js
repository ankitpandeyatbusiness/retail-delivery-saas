const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    description: String,
    image: String,

    price: { type: Number, required: true, min: 0 },   // starting price
    mrp: Number,                                        // price before discount

    // Food type flags
    isVeg: { type: Boolean, default: true },
    isEggless: { type: Boolean, default: false },
    isSugarFree: { type: Boolean, default: false },
    isJain: { type: Boolean, default: false },
    spiceLevel: { type: String, enum: ['none', 'mild', 'medium', 'hot'], default: 'none' },

    // Selling flags
    isBestseller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },   // not "isNew": Mongoose reserves that name
    isGiftPack: { type: Boolean, default: false },
    serves: Number,
    prepTimeMin: Number,

    // Options (which ones show is decided by homeConfig.itemOptions)
    sizes: [{ _id: false, label: String, price: Number }],              // Half / Full, S / M / L
    weightOptions: [{ _id: false, grams: Number, price: Number }],      // 250g, 500g, 1kg
    addOns: [{ _id: false, name: String, price: Number }],

    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },

    isAvailable: { type: Boolean, default: true },     // temporarily out of stock
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

productSchema.index({ tenantId: 1, isActive: 1, categoryId: 1 });
productSchema.index({ tenantId: 1, isActive: 1, isBestseller: -1, orderCount: -1 });

module.exports = mongoose.model('Product', productSchema);