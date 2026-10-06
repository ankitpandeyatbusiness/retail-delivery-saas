const mongoose = require('mongoose');

// No `timestamps` option on purpose: favourites are added with an upsert that sets createdAt itself.
const favouriteSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    createdAt: { type: Date, default: Date.now },
});

favouriteSchema.index({ tenantId: 1, userId: 1, productId: 1 }, { unique: true });
favouriteSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('Favourite', favouriteSchema);