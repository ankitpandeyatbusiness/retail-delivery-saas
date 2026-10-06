const mongoose = require('mongoose');

// One rating per dish per order. Product.rating / ratingCount are recalculated from these.
const reviewSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 300 },
}, { timestamps: true });

reviewSchema.index({ tenantId: 1, orderId: 1, productId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ tenantId: 1, productId: 1 });

module.exports = mongoose.model('Review', reviewSchema);