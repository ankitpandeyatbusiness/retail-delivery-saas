const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    key: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    kind: { type: String, required: true },       // logo, product, category, banner, collection, rider, order
    refType: String,
    refId: String,
    bytes: Number,
    width: Number,
    height: Number,
    uploadedBy: { type: { type: String }, id: String, label: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

mediaSchema.index({ tenantId: 1, kind: 1, refId: 1 });

module.exports = mongoose.model('Media', mediaSchema);