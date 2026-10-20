const mongoose = require('mongoose');

// A person who works for ONE shop and logs in to the app with a phone number: the kitchen cook ('kitchen') or the waiter ('waiter').
// Every Staff row belongs to a User whose role is the same word. One person has one job in a shop. The owner adds them (services/staffService.js).
const staffSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['kitchen', 'waiter'], required: true },
    name: { type: String, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true },   // the owner can pause a person without removing them
    lastSeenAt: Date,
}, { timestamps: true });

staffSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
staffSchema.index({ tenantId: 1, role: 1, isActive: 1 });

module.exports = mongoose.model('Staff', staffSchema);
