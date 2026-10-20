const mongoose = require('mongoose');

// One table's visit: from the first order until the bill is paid. Every order of the visit (a "round") points to it by Order.tableSessionId.
// open       people are eating and may order more      bill_asked   a customer asked for the bill      closed   paid (or ended)
const tableSessionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    table: { type: String, required: true },
    status: { type: String, enum: ['open', 'bill_asked', 'closed'], default: 'open' },
    customers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],   // everyone who ordered at this table: all of them see the bill
    openedAt: { type: Date, default: Date.now },
    lastOrderAt: { type: Date, default: Date.now },
    billAskedAt: Date,
    closedAt: Date,
    closedBy: { type: String, enum: ['owner', 'auto'] },
    // "I already paid": the customer says he paid what he owed; the owner answers yes (cleared) or no (reply with a message)
    claimAt: Date, claimBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    claimReply: { _id: false, ok: Boolean, message: String, at: Date },
    tipPaise: { type: Number, default: 0 },   // the tip the guest chose for the waiter (collected with the bill, not part of the shop's sales)
    autoRemindCount: { type: Number, default: 0 },   // daily reminders sent by themselves (they stop after the owner's limit)
    forgiven: Boolean,      // the owner wrote the bill off
    lastRemindAt: Date,     // the owner (or the daily reminder) last reminded the customer about the unpaid bill
    lastNudgeAt: Date,      // the customer last pressed "please hurry"
    checkNotifiedAt: Date,  // the owner was told "check on this table" (people finished eating, nobody asked for the bill)
    walkout: { type: Boolean, default: false },   // the customer left without paying
    owedPaise: { type: Number, default: 0 },
    owedClearedAt: Date,
    owedVia: String,
    paidVia: String,        // cash | upi (at the counter)
    paidPaise: { type: Number, default: 0 },
}, { timestamps: true });

// one open visit per table
tableSessionSchema.index({ tenantId: 1, table: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['open', 'bill_asked'] } } });
tableSessionSchema.index({ tenantId: 1, customers: 1, status: 1 });

module.exports = mongoose.model('TableSession', tableSessionSchema);
