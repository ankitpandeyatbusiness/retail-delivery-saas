const mongoose = require('mongoose');

// Real money the supreme admin sent BACK to a shop's payment method (an emergency): part of a plan payment, or the unused part of a wallet.
// services/emergencyRefund.js writes it; services/platformSales.js shows a processed one as a negative row so the money screens net it.
const platformRefundSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, enum: ['plan', 'wallet', 'sms'], required: true },
    salesKind: { type: String, enum: ['plan', 'branch', 'wallet', 'sms'], required: true },   // how the money screens file it
    sourceId: { type: String, required: true },          // the PlanPayment / PartnerTopup / SmsTopup it comes back from
    paymentId: String,                                    // the captured payment at the payment partner
    cashPaise: { type: Number, required: true },          // what goes back to the payment method (GST included)
    basePaise: { type: Number, default: 0 },              // the part that was the price / the wallet money
    gstPaise: { type: Number, default: 0 },               // the GST part of it
    walletPaise: { type: Number, default: 0 },            // taken out of the wallet balance (wallet refunds)
    counted: { type: Boolean, default: true },            // the source was a paid, counted sale (a held payment never was)
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
    refundId: String,
    error: String,
    reason: { type: String, required: true, maxlength: 300 },
    by: String,
    key: { type: String, required: true, unique: true },  // one request id + part number: a double tap cannot refund twice
    endedPlan: { type: Boolean, default: false },
    creditNote: { type: mongoose.Schema.Types.Mixed },   // the GST credit note for this refund (made once the refund is sent)
}, { timestamps: true });

module.exports = mongoose.models.PlatformRefund || mongoose.model('PlatformRefund', platformRefundSchema);
