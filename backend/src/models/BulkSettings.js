const mongoose = require('mongoose');

// One row per shop: the rules of its bulk orders (the "menu section" settings). Kept apart from the normal order settings,
// because a bulk order has its own minimums and its own delivery fee. Rupees, except where a name says Paise.
const feeSchema = new mongoose.Schema({
    type: { type: String, enum: ['free', 'flat', 'free_above', 'distance'], default: 'free' },
    amount: { type: Number, min: 0, max: 5000, default: 0 },
    freeAbove: { type: Number, min: 0, max: 1000000, default: 0 },
    baseKm: { type: Number, min: 0, max: 100, default: 0 },
    baseFee: { type: Number, min: 0, max: 5000, default: 0 },
    perKmFee: { type: Number, min: 0, max: 500, default: 0 },
    maxFee: { type: Number, min: 0, max: 5000, default: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    enabled: { type: Boolean, default: false },
    minOrderAmount: { type: Number, min: 0, max: 1000000, default: 0 },   // the least a whole bulk order may cost (after the bulk prices)
    noticeHours: { type: Number, min: 0, max: 720, default: 48 },         // how long before the pickup / delivery time it must be asked
    maxQtyPerDish: { type: Number, min: 2, max: 10000, default: 500 },
    pickup: { type: Boolean, default: true },
    delivery: { type: Boolean, default: true },
    deliveryFee: { type: feeSchema, default: () => ({}) },                 // the bulk delivery fee, same kinds as the normal one
    packagingCharge: { type: Number, min: 0, max: 5000, default: 0 },
    advancePercent: { type: Number, min: 10, max: 100, default: 50 },     // what the customer pays to confirm (the owner can change it in each quote)
    quoteValidHours: { type: Number, min: 1, max: 168, default: 24 },
    fullRefundHours: { type: Number, min: 0, max: 720, default: 48 },     // cancel this long before the time: the whole advance goes back; later the shop keeps it
}, { timestamps: true });

module.exports = mongoose.model('BulkSettings', schema);
