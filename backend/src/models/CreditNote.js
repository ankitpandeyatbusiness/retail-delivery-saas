const mongoose = require('mongoose');

const { Schema } = mongoose;

// A credit note: the platform cancels a bill it already issued (a bill that was voided or waived). A saved copy of the bill's
// figures, so it never changes later. Numbered CN/<prefix>/2026-27/0001 (services/platformInvoicing.js).
const partySchema = new Schema({
    legalName: String, address: String, gstin: String, pan: String, state: String, stateCode: String, email: String, phone: String,
    sacCode: String, paymentInstructions: String,
}, { _id: false });

const creditNoteSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    invoiceNo: { type: String, required: true, unique: true },            // the credit note's own number (named like an invoice so one PDF layout serves both)
    issueDate: { type: Date, required: true },
    originalInvoiceId: { type: Schema.Types.ObjectId, ref: 'SubscriptionInvoice', required: true },
    originalInvoiceNo: String,
    originalIssueDate: Date,
    reason: { type: String, trim: true, maxlength: 200 },
    period: String,
    lineItems: [{ _id: false, description: String, qty: Number, rate: Number, amount: Number }],
    baseAmount: { type: Number, required: true, min: 0 },
    gstPercent: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    placeOfSupply: { _id: false, code: String, name: String },
    taxSplit: { _id: false, intraState: Boolean, cgst: Number, sgst: Number, igst: Number },
    reverseCharge: { type: Boolean, default: false },
    total: { type: Number, required: true, min: 0 },
    seller: partySchema,
    buyer: partySchema,
    createdBy: String,
}, { timestamps: true });

creditNoteSchema.index({ tenantId: 1, issueDate: -1 });
creditNoteSchema.index({ originalInvoiceId: 1 }, { unique: true });   // one credit note per bill

module.exports = mongoose.model('CreditNote', creditNoteSchema);
