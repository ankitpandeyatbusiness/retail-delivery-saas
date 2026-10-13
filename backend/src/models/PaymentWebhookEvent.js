// Every webhook we accepted, once. Razorpay sends the same event again when we answer with an error (and sometimes anyway).
const mongoose = require('mongoose');

const { Schema } = mongoose;

const schema = new Schema({
    account: { type: String, required: true },   // 'platform' or a shop id
    eventId: { type: String, required: true },
    event: String,
    status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
    attempts: { type: Number, default: 1 },
    error: String,
}, { timestamps: true });

schema.index({ account: 1, eventId: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });

module.exports = mongoose.model('PaymentWebhookEvent', schema);