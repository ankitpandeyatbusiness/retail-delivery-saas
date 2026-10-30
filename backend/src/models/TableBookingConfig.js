const mongoose = require('mongoose');

// One shop's table booking rules: when guests can book, how many seats a slot holds, and the deposit they must pay.
const configSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    enabled: { type: Boolean, default: false },            // the owner's on/off slider
    windows: [{ _id: false, days: [String], open: String, close: String }],   // days empty = every day; times "HH:MM"
    slotMinutes: { type: Number, default: 60 },
    seatsPerSlot: { type: Number, default: 20 },           // guests the shop can seat for one slot
    minParty: { type: Number, default: 1 },
    maxParty: { type: Number, default: 12 },
    advanceDays: { type: Number, default: 14 },            // how far ahead a guest can book
    minNoticeMinutes: { type: Number, default: 60 },       // no booking for a slot that starts sooner than this
    closedDates: [String],                                 // "YYYY-MM-DD": no bookings that whole day
    closedSlots: [{ _id: false, date: String, time: String }],
    depositType: { type: String, enum: ['flat', 'per_person'], default: 'per_person' },
    depositAmount: { type: Number, default: 0 },           // rupees; must be above 0 to switch booking on
    depositMode: { type: String, enum: ['adjust', 'keep'], default: 'adjust' },   // taken off the bill, or kept by the shop
    refundHours: { type: Number, default: 2 },             // full refund when cancelled at least this many hours before
    holdMinutes: { type: Number, default: 10 },            // an unpaid booking is let go after this
}, { timestamps: true });

module.exports = mongoose.model('TableBookingConfig', configSchema);
