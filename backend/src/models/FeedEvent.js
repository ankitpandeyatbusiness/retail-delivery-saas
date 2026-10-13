const mongoose = require('mongoose');

// One line of the live feed. Never holds a phone number. Deleted by MongoDB after 3 days.
const feedEventSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    category: { type: String, required: true },   // orders, riders, billing, sms, settings, logins, complaints, messages
    type: { type: String, required: true, maxlength: 40 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { minimize: false });

feedEventSchema.index({ tenantId: 1, at: -1 });
feedEventSchema.index({ at: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });

module.exports = mongoose.model('FeedEvent', feedEventSchema);