// One complaint per delivered order, within 24 hours of delivery.
const mongoose = require('mongoose');

const TYPES = ['missing_item', 'wrong_item', 'quality', 'late', 'packaging', 'other'];
const RESOLUTIONS = ['none', 'refund_full', 'refund_partial', 'no_refund'];

const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    orderNo: Number,
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    customerName: String,
    type: { type: String, enum: TYPES, required: true },
    text: { type: String, required: true, maxlength: 500 },
    photos: { type: [String], default: [] },
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
    ownerReply: { type: String, maxlength: 500 },
    resolution: { type: String, enum: RESOLUTIONS, default: 'none' },
    refundPaise: { type: Number, default: 0, min: 0 },
    // none: no money | noted: COD or unpaid, decision only | pending: online, waiting for the payout | done | failed
    refundStatus: { type: String, enum: ['none', 'noted', 'pending', 'done', 'failed'], default: 'none' },
    decidedAt: Date,
    decidedBy: String,
    remindedAt: Date,
}, { timestamps: true });

schema.index({ tenantId: 1, orderId: 1 }, { unique: true });          // one per order
schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.index({ status: 1, remindedAt: 1, createdAt: 1 });             // reminder job

module.exports = mongoose.models.Complaint || mongoose.model('Complaint', schema);
module.exports.TYPES = TYPES;
module.exports.RESOLUTIONS = RESOLUTIONS;