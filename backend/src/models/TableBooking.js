const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true },                // short code the guest shows at the door
    name: { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 20 },
    date: { type: String, required: true },                // "YYYY-MM-DD" (India)
    time: { type: String, required: true },                // "HH:MM"
    startsAt: { type: Date, required: true },
    party: { type: Number, required: true, min: 1 },
    note: { type: String, maxlength: 300, default: '' },
    status: { type: String, enum: ['confirmed', 'seated', 'no_show', 'cancelled'], default: 'confirmed' },
    deposit: {
        amount: { type: Number, default: 0 },              // rupees, worked out when the guest booked
        status: { type: String, enum: ['unpaid', 'paid', 'refunded', 'kept', 'adjusted'], default: 'unpaid' },
    },
    cancelledBy: { type: String, enum: ['customer', 'owner'] },
    cancelledAt: Date,
}, { timestamps: true });

bookingSchema.index({ tenantId: 1, date: 1, time: 1 });
bookingSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('TableBooking', bookingSchema);
