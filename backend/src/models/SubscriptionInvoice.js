const mongoose = require('mongoose');

const { Schema } = mongoose;

// The monthly bill YOU send to a shop for using the app. Everything is a saved copy,
// so an old invoice never changes when the fee or the business details change later.
const partySchema = new Schema({
    legalName: String,
    address: String,
    gstin: String,
    email: String,
    phone: String,
    sacCode: String,
    paymentInstructions: String,
}, { _id: false });

const subscriptionInvoiceSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },   // "2026-10"
    invoiceNo: { type: String, required: true, unique: true },                     // "SUB/2026-27/0001"

    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },

    description: String,
    baseAmount: { type: Number, required: true, min: 0 },
    gstPercent: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },

    seller: partySchema,   // you
    buyer: partySchema,    // the shop

    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    paidAt: Date,
    paymentMode: { type: String, enum: ['upi', 'bank_transfer', 'cash', 'cheque', 'other'] },
    paymentRef: { type: String, trim: true, maxlength: 60 },
    note: { type: String, trim: true, maxlength: 200 },
    markedBy: String,      // which superadmin changed the status
}, { timestamps: true });

subscriptionInvoiceSchema.index({ tenantId: 1, period: 1 }, { unique: true });   // one invoice per shop per month
subscriptionInvoiceSchema.index({ status: 1, dueDate: 1 });
subscriptionInvoiceSchema.index({ tenantId: 1, issueDate: -1 });

module.exports = mongoose.model('SubscriptionInvoice', subscriptionInvoiceSchema);