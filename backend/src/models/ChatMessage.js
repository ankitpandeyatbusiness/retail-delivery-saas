const mongoose = require('mongoose');

// One message of a chat between a customer and the shop's owner, about one bulk order, one service inquiry or one table booking.
// The ticks: sent = saved here; delivered = the other person's app has it (deliveredAt); read = he opened the chat (readAt).
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, enum: ['bulk', 'inquiry', 'booking'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },          // the bulk order, inquiry or booking
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // the customer of that thing (so "my unread" is one query)
    from: { type: String, enum: ['customer', 'owner'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId },
    text: { type: String, maxlength: 1000, default: '' },
    images: { type: [String], default: undefined },                           // up to 4 pictures
    voice: { _id: false, url: String, sec: Number },                          // a voice note (up to 2 minutes)
    clientId: String,                                                         // made by the phone: a message sent twice is saved once
    deliveredAt: Date,
    readAt: Date,
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ tenantId: 1, kind: 1, refId: 1, createdAt: 1 });
schema.index({ tenantId: 1, customerId: 1, from: 1, readAt: 1 });
schema.index({ tenantId: 1, from: 1, readAt: 1 });
schema.index({ refId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });

module.exports = mongoose.model('ChatMessage', schema);
