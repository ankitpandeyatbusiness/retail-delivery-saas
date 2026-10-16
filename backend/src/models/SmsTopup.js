const mongoose = require('mongoose');

// One QR request for an SMS top-up. The wallet is credited only by smsTopupService.complete().
const smsTopupSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    amountPaise: { type: Number, required: true, validate: Number.isInteger },   // what the wallet gets (what the owner typed)
    gstPercent: { type: Number, default: 0 },                                    // GST added on top of it
    gstPaise: { type: Number, default: 0 },
    payablePaise: Number,                                                       // what the owner pays = amountPaise + gstPaise (old top-ups: not set = amountPaise)
    status: { type: String, enum: ['pending', 'paid', 'expired'], default: 'pending' },
    qrId: String,
    rzpOrderId: String,      // paid with a UPI app or card: the Razorpay order the app pays (services/platformCheckout.js)
    upiString: String,
    imageUrl: String,
    expiresAt: Date,
    paymentId: String,       // provider payment id (from the webhook), for records
    paidAt: Date,
    // the tax invoice / receipt for this top-up, a saved copy made when it is paid (services/smsTopupService.js ensureInvoice)
    invoice: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: { type: String }, id: String, label: String },
    paidBy: { type: { type: String }, id: String, label: String },
}, { timestamps: true });

smsTopupSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('SmsTopup', smsTopupSchema);