const mongoose = require('mongoose');

// One row = one guest has a booking at this day and time. A guest cannot hold two tables for the same time (a double tap, two phones),
// by the same unique-index rule as BookingTableLock.
const lockSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });

lockSchema.index({ tenantId: 1, userId: 1, date: 1, time: 1 }, { unique: true });
lockSchema.index({ bookingId: 1 });

module.exports = mongoose.model('BookingUserLock', lockSchema);
