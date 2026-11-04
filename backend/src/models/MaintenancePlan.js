const mongoose = require('mongoose');

// A planned maintenance: from a start time (and until an end time, or until the superadmin switches it off), for every shop, chosen shops or a brand.
// People are warned in advance (services/maintenancePlans.js); at the start time the shops' apps pause by themselves.
const schema = new mongoose.Schema({
    scope: { type: String, enum: ['all', 'shops', 'brand'], required: true },
    tenantIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },     // the shops (a brand's branches are listed here when it is planned); empty for "all"
    brandId: mongoose.Schema.Types.ObjectId,
    brandName: String,
    startAt: { type: Date, required: true },
    endAt: Date,                                                            // none = until the superadmin switches it off
    message: { type: String, trim: true, maxlength: 200, default: '' },
    audience: {                                                             // who is warned and told
        owners: { type: Boolean, default: true }, staff: { type: Boolean, default: true },
        riders: { type: Boolean, default: true }, customers: { type: Boolean, default: true },
    },
    status: { type: String, enum: ['planned', 'active', 'ended', 'cancelled'], default: 'planned' },
    sent: { type: [String], default: [] },                                  // the notices already sent: announce, 24h, 1h, 15m, start, end
    startedAt: Date,
    endedAt: Date,
    createdBy: String,
    endedBy: String,
}, { timestamps: true });

schema.index({ status: 1, startAt: 1 });
schema.index({ status: 1, endAt: 1 });

module.exports = mongoose.model('MaintenancePlan', schema);
