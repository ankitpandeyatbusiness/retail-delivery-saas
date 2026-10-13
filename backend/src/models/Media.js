const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    key: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    kind: { type: String, required: true },
    refType: { type: String },
    refId: { type: String },
    bytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    uploadedBy: {
        type: { type: String },
        id: { type: String },
        label: { type: String },
    },
}, { timestamps: { createdAt: true, updatedAt: false } });

mediaSchema.index({ tenantId: 1, kind: 1, refId: 1 });

module.exports = mongoose.models.Media || mongoose.model('Media', mediaSchema);