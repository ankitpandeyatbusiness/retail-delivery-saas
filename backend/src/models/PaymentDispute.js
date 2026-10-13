// A customer's bank questions a payment (chargeback). Razorpay tells us by webhook; the superadmin keeps evidence notes.
const mongoose = require('mongoose');

const { Schema } = mongoose;

const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'OnlinePayment', required: true },
    rzpPaymentId: { type: String, required: true },
    rzpDisputeId: { type: String, required: true },
    // created, under_review, action_required are OPEN. won, lost, closed are FINAL.
    status: { type: String, enum: ['created', 'under_review', 'action_required', 'won', 'lost', 'closed'], required: true },
    amountPaise: { type: Number, default: 0 },
    reasonCode: String,
    phase: String,
    respondBy: Date,
    history: [{ _id: false, status: String, at: Date }],
    notes: [{ _id: false, at: Date, by: String, text: String }],   // evidence notes by the superadmin
}, { timestamps: true });

schema.index({ rzpDisputeId: 1 }, { unique: true });
schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ paymentId: 1, status: 1 });

module.exports = mongoose.model('PaymentDispute', schema);