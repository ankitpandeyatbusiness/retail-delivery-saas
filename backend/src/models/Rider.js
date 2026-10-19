const mongoose = require('mongoose');

// Rider profile for a User with role "rider". One per shop. Orders point to the User id (userId).
const riderSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true },     // owner can switch a rider off
    isOnline: { type: Boolean, default: false },    // the rider goes online or offline in the app
    onlineSince: Date,                              // when he went on duty (a very long duty puts him off, jobs/riderDuty.js)
    vehicle: { type: { type: String, trim: true, maxlength: 20 }, number: { type: String, trim: true, maxlength: 20 } },
    photo: String,
    pay: mongoose.Schema.Types.Mixed,   // his own pay plan (services/riderPay.js); empty = the shop's plan
    // duty timing (services/riderSchedule.js): 'auto' = on and off duty by himself at his times; 'manual' = he does it by hand
    duty: {
        mode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
        weekly: mongoose.Schema.Types.Mixed,    // { mon: { on, from: '09:00', to: '21:00' }, ... }
        lastAutoOn: Date,
        autoSession: { type: Boolean, default: false },   // the duty he is on now was started by the schedule
    },
    holidays: [{ from: String, to: String, note: { type: String, maxlength: 80 } }],   // days off he added himself
    lastLocation: { lat: Number, lng: Number, at: Date },   // OLD: no longer written. The live position is memory only (services/liveTracking.js)
    activeOrderCount: { type: Number, default: 0, min: 0 },   // offered + accepted + picked up
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    faultCount: { type: Number, default: 0 },   // complaints the owner decided were the rider's fault
    // the record of his journeys (collected -> delivered), kept by services/deliveryPlan.js. Only a record, never a warning.
    deliveryCount: { type: Number, default: 0 },
    deliverySecTotal: { type: Number, default: 0 },
    lateCount: { type: Number, default: 0 },    // deliveries that took longer than the time allowed
}, { timestamps: true });

riderSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
riderSchema.index({ tenantId: 1, isActive: 1, isOnline: 1 });

module.exports = mongoose.model('Rider', riderSchema);