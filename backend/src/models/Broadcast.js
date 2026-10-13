const mongoose = require('mongoose');

// One message sent to many people: from a shop owner to his customers or riders,
// or from the superadmin to shop owners. Messages never go by SMS.
const broadcastSchema = new mongoose.Schema({
    senderType: { type: String, enum: ['owner', 'superadmin'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderLabel: { type: String, maxlength: 80 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },        // owner broadcasts: his shop
    tenantIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },       // superadmin: chosen shops, empty = all shops
    audience: { type: String, enum: ['customers', 'riders', 'both', 'owners'], required: true },
    kind: { type: String, enum: ['info', 'promo'], default: 'info' },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 1000 },
    sendEmail: { type: Boolean, default: false },
    status: { type: String, enum: ['queued', 'sending', 'done', 'failed'], default: 'queued' },
    recipients: { type: Number, default: 0 },
    skippedOptOut: { type: Number, default: 0 },   // promo: customers who switched promotions off
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date,
}, { timestamps: true });

broadcastSchema.index({ tenantId: 1, createdAt: -1 });
broadcastSchema.index({ senderType: 1, createdAt: -1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);