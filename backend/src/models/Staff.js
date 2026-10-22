const mongoose = require('mongoose');

// A person who works for ONE shop and logs in to the app with a phone number: the kitchen cook ('kitchen') or the waiter ('waiter').
// Every Staff row belongs to a User whose role is the same word. One person has one job in a shop. The owner adds them (services/staffService.js).
const staffSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['kitchen', 'waiter'], required: true },
    name: { type: String, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true },   // the owner can pause a person without removing them
    photo: String,   // their own picture (set from their Profile)
    lastSeenAt: Date,
    // working time (services/staffDuty.js): Go live, weekly hours and days off. Alerts go only to people on duty.
    duty: {
        _id: false,
        online: { type: Boolean, default: true },
        mode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
        weekly: mongoose.Schema.Types.Mixed,   // { mon: { on, from: '09:00', to: '21:00' }, ... }
    },
    holidays: [{ from: String, to: String, note: { type: String, maxlength: 80 }, leaveId: mongoose.Schema.Types.ObjectId }],   // leaveId: this day off is an approved leave (services/staffLeave.js)   // days off (holiday or leave), India dates
    prefs: {
        _id: false,
        tellDone: { type: Boolean, default: true },   // a cook: be told when an order was handed over, collected by the rider or served (off = never)
    },
}, { timestamps: true });

staffSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
staffSchema.index({ tenantId: 1, role: 1, isActive: 1 });

module.exports = mongoose.model('Staff', staffSchema);
