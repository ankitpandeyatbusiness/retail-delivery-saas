const mongoose = require('mongoose');

// An alert SMS to the superadmin that the PLATFORM paid itself, because no shop could pay.
const platformSmsCostSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    eventKey: { type: String, maxlength: 60 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },   // the shop the alert was about
    costPaise: { type: Number, required: true, validate: Number.isInteger },
    phoneMasked: String,
});

platformSmsCostSchema.index({ at: -1 });

module.exports = mongoose.model('PlatformSmsCost', platformSmsCostSchema);