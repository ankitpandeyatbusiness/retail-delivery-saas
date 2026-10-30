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
    endsAt: Date,                                          // when the slot is over: the guest's table card stays until then
    remindedAt: Date,                                      // the 30 minute reminder went to the guest and the owner (once)
    party: { type: Number, required: true, min: 1 },
    note: { type: String, maxlength: 300, default: '' },
    // held = waiting for the deposit (seats are kept until holdUntil); only a paid booking is confirmed
    status: { type: String, enum: ['held', 'confirmed', 'seated', 'no_show', 'cancelled', 'expired'], default: 'held' },
    holdUntil: Date,
    approvedAt: Date,                                      // the owner tapped Allow
    cancelNote: { type: String, maxlength: 300 },          // what the owner wrote when he denied the booking
    sessionId: mongoose.Schema.Types.ObjectId,             // the table visit the deposit was taken off (adjust mode)
    rules: { refundHours: Number, depositMode: { type: String, enum: ['adjust', 'keep'] } },   // the shop's rules as they were when the guest booked
    seller: { name: String, gstin: String, fssai: String },   // the shop's details copied when the deposit was paid, so the receipt never changes
    payment: { rzpOrderId: String, rzpPaymentId: String, amountPaise: Number, paidAt: Date },
    deposit: {
        amount: { type: Number, default: 0 },              // rupees, worked out when the guest booked
        // paid -> refunding -> refunded, or kept (the shop keeps it), or adjusted (taken off the table bill)
        status: { type: String, enum: ['unpaid', 'paid', 'refunding', 'refunded', 'refund_failed', 'kept', 'adjusted'], default: 'unpaid' },
        refundId: String,
        refundedAt: Date,
        refundError: String,
        credit: { type: String, enum: ['pending', 'applied'] },   // adjust mode: waiting to be taken off the guest's table bill
    },
    cancelledBy: { type: String, enum: ['customer', 'owner', 'system'] },
    cancelledAt: Date,
}, { timestamps: true });

bookingSchema.index({ tenantId: 1, date: 1, time: 1 });
bookingSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, holdUntil: 1 });
bookingSchema.index({ 'payment.rzpOrderId': 1 });

module.exports = mongoose.model('TableBooking', bookingSchema);
