const mongoose = require('mongoose');

// A guest who wants a table in a slot that is full. When a table in that slot frees up, he is told (services/bookingWaitlist.js).
const waitSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, maxlength: 80 },
    phone: { type: String, maxlength: 20 },
    date: { type: String, required: true },
    time: { type: String, required: true },
    party: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['waiting', 'booked', 'left', 'expired'], default: 'waiting' },
    notifiedAt: Date,   // the last time he was told a table is free
}, { timestamps: true });

waitSchema.index({ tenantId: 1, date: 1, time: 1, status: 1, createdAt: 1 });
waitSchema.index({ tenantId: 1, userId: 1, date: 1, time: 1 }, { unique: true });

module.exports = mongoose.model('WaitlistEntry', waitSchema);
