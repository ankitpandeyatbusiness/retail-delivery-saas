const mongoose = require('mongoose');

// How many seats are taken for one shop, day and slot. Kept as a counter so two guests booking at the same moment
// can never take more seats than the slot holds (see services/tableBooking.js reserve()).
const useSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    seats: { type: Number, default: 0 },
}, { timestamps: true });

useSchema.index({ tenantId: 1, date: 1, time: 1 }, { unique: true });

module.exports = mongoose.model('BookingSlotUse', useSchema);
