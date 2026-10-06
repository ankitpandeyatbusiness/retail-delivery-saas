const mongoose = require('mongoose');

// A hand-picked group of existing products shown as a strip on the home screen.
//   kind "festival": "Diwali Gift Boxes", "Rakhi Special" (usually with start/end dates)
//   kind "combo":    "Meal Deals" (each combo is a normal Product with its own price,
//                    e.g. "Biryani + Raita + Coke", so ordering needs no special handling)
const collectionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, enum: ['festival', 'combo'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 60 },
    subtitle: { type: String, trim: true, maxlength: 120 },
    image: String,
    productIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
        validate: [(v) => v.length <= 30, 'A collection can have at most 30 items'],
    },
    startsAt: Date,
    endsAt: Date,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

collectionSchema.index({ tenantId: 1, kind: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Collection', collectionSchema);