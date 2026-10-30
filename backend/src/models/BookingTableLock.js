const mongoose = require('mongoose');

// One row = one table taken for one day and slot. The unique index is what makes double booking impossible: of two guests who ask for the same
// table at the same moment, the database lets exactly one row in (services/tableBooking.js lock()).
const lockSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    table: { type: String, required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });

lockSchema.index({ tenantId: 1, date: 1, time: 1, table: 1 }, { unique: true });
lockSchema.index({ bookingId: 1 });

module.exports = mongoose.model('BookingTableLock', lockSchema);
