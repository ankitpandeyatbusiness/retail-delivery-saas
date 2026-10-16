const mongoose = require('mongoose');

// One inbox message.
//   userId set   -> for one person (a customer or a rider)
//   role "owner" -> for the shop owner side (shared by all owners of that shop)
const notificationSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: function () { return this.role !== 'superadmin'; } },   // platform alerts belong to no shop
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['owner', 'superadmin'] },   // superadmin = the platform inbox (late-order alerts)
    type: { type: String, required: true, maxlength: 40 },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, maxlength: 300 },
    data: { type: mongoose.Schema.Types.Mixed },
    readAt: Date,
    supremeOnly: Boolean,   // a platform alert only the supreme admin may see (the settlement sheet)
    clearedAt: Date,    // the owner pressed "Clear all": hidden from his inbox (the row stays for the escalation job and the 90-day cleanup)
    escalateAt: Date,   // send the key-event SMS if he has not read it by then
    smsSentAt: Date,    // the SMS was sent (or tried) once
}, { timestamps: { createdAt: true, updatedAt: false } });

notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, role: 1, createdAt: -1 });
notificationSchema.index({ role: 1, createdAt: -1 });
notificationSchema.index({ escalateAt: 1 }, { partialFilterExpression: { escalateAt: { $exists: true } } });   // the SMS escalation job
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });   // old messages delete themselves after 90 days

module.exports = mongoose.model('Notification', notificationSchema);