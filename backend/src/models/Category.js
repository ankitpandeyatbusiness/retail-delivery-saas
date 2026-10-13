const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true },
    image: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    timings: [{ _id: false, days: [String], open: String, close: String }],   // menu timings, empty = always shown
}, { timestamps: true });

categorySchema.index({ tenantId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Category', categorySchema);