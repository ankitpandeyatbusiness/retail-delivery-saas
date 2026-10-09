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
    kind: { type: String, enum: ['monthly', 'custom'], default: 'monthly' },
    // custom invoices may have no period
    period: { type: String, required: function () { return this.kind !== 'custom'; }, match: /^\d{4}-(0[1-9]|1[0-2])$/ },   // "2026-10"
    lineItems: [{ _id: false, description: String, qty: Number, rate: Number, amount: Number }],
    orderCount: Number,        // delivered orders of that month (monthly invoices)
    tierLabel: String,         // e.g. "306 to 1005 orders"
    graceEndsAt: Date,
    notifiedAt: Date,              // "new bill" message sent
    reminderForGraceAt: Date,      // the grace end date the "2 days left" reminder was sent for
    pausedNoticeFor: Date,         // the grace end date the "shop paused" message was sent for
    paidNotifiedAt: Date,          // "payment received" message sent
    voidedAt: Date,
    voidReason: { type: String, trim: true, maxlength: 200 },
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

    status: { type: String, enum: ['pending', 'paid', 'void'], default: 'pending' },
    paidAt: Date,
    paymentMode: { type: String, enum: ['upi', 'bank_transfer', 'cash', 'cheque', 'other'] },
    paymentRef: { type: String, trim: true, maxlength: 60 },
    note: { type: String, trim: true, maxlength: 200 },
    markedBy: String,      // which superadmin changed the status
}, { timestamps: true });

// one MONTHLY invoice per shop per month (custom invoices are not limited)
subscriptionInvoiceSchema.index(
    { tenantId: 1, period: 1, kind: 1 },
    { unique: true, partialFilterExpression: { kind: 'monthly' }, name: 'tenant_period_kind_monthly' },
);
subscriptionInvoiceSchema.index({ status: 1, dueDate: 1 });
subscriptionInvoiceSchema.index({ tenantId: 1, issueDate: -1 });

module.exports = mongoose.model('SubscriptionInvoice', subscriptionInvoiceSchema);