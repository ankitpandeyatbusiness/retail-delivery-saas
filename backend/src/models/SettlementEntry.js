const mongoose = require('mongoose');

const { Schema } = mongoose;

// One row of the common settlement sheet: the money the two partners (the platform owner and the operator partner) owe each other.
// The sheet holds NUMBERS only; the real money moves between them outside the app.
//   receipt     a shop paid rent, a setup fee or an SMS top-up. Made by itself when the payment arrives.
//   cost        a shared cost (SMS provider recharge, server, database, API, misc). One partner paid it all, the other owes his share.
//   adjustment  a correction the supreme admin writes by hand.
// Nothing is ever deleted; every change is a line in `events`.
const eventSchema = new Schema({
    at: { type: Date, default: Date.now },
    by: { _id: false, id: String, name: String },
    action: { type: String, enum: ['created', 'paid', 'claim', 'claim_confirmed', 'claim_rejected', 'setoff', 'brought_by', 'edited', 'voided', 'restored'], required: true },
    amount: Number,
    date: Date,          // the date the money really moved (can be earlier than `at`)
    ref: String,
    note: String,
    setoffId: String,
    status: String,      // the status after this event
}, { _id: false });

const settlementEntrySchema = new Schema({
    no: { type: Number, required: true, unique: true },                 // 1, 2, 3 ... easy to talk about
    kind: { type: String, enum: ['receipt', 'cost', 'adjustment'], required: true },
    category: { type: String, required: true },                         // rent | setup | topup | sms_recharge | server | database | api | misc | adjustment
    key: { type: String },                                              // one receipt = one row (inv:<id>, topup:<id>)
    title: { type: String, trim: true, maxlength: 120 },
    date: { type: Date, required: true },                               // the day the payment was captured / the cost was paid

    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    shopName: String,
    invoiceNo: String,
    invoiceId: { type: Schema.Types.ObjectId },
    topupId: { type: Schema.Types.ObjectId },

    // receipts
    baseAmount: Number,                                                 // before GST: what is shared
    gstAmount: Number,
    totalAmount: Number,
    broughtBy: { type: String, enum: ['owner', 'partner', null] },      // who brought the shop (null = not marked yet)
    // who got the money
    receivedBy: { type: String, enum: ['owner', 'partner'] },
    // costs / adjustments
    amount: Number,                                                     // the whole cost
    paidBy: { type: String, enum: ['owner', 'partner'] },

    ratio: { _id: false, ownerPct: Number, partnerPct: Number },
    ownerShare: Number,
    partnerShare: Number,
    owes: { type: String, enum: ['owner', 'partner', null], default: null },   // who has to pay the other
    dueAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
    dueAt: Date,
    voided: { type: Boolean, default: false },                          // the payment behind it was undone

    // the partner says "I have paid"; the supreme admin confirms
    claim: { _id: false, amount: Number, date: Date, ref: String, note: String, at: Date, by: { _id: false, id: String, name: String }, state: { type: String, enum: ['open', 'confirmed', 'rejected'] } },

    note: { type: String, trim: true, maxlength: 300 },
    events: [eventSchema],
}, { timestamps: true });

settlementEntrySchema.index({ key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
settlementEntrySchema.index({ date: -1 });
settlementEntrySchema.index({ status: 1, dueAt: 1 });
settlementEntrySchema.index({ tenantId: 1, date: -1 });

module.exports = mongoose.model('SettlementEntry', settlementEntrySchema);
