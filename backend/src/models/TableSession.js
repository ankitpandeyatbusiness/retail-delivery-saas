const mongoose = require('mongoose');

// One table's visit: from the first order until the bill is paid. Every order of the visit (a "round") points to it by Order.tableSessionId.
// open       people are eating and may order more      bill_asked   a customer asked for the bill      closed   paid (or ended)
const tableSessionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    table: { type: String, required: true },
    kind: { type: String, enum: ['table', 'pickup'], default: 'table' },   // 'pickup': an unpaid pickup order, kept as a bill he owes (same reminders, same block)
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    party: { type: Number, default: 1 },   // shared tables (services/sharedTables.js): the number of this bill at the table (1, 2, 3...); label A, B, C...
    label: String,
    left: [{ _id: false, userId: mongoose.Schema.Types.ObjectId, at: Date, paidPaise: Number, via: String, by: String }],   // guests who paid their share (or left unpaid) and are no longer on this bill
    presence: mongoose.Schema.Types.Mixed,   // services/guestWatch.js: { <userId>: { at, loc, locAt } } what each guest's app last said
    watch: mongoose.Schema.Types.Mixed,      // { <userId>: 'unreachable' | 'location_off' }: what the owner was last told about each guest
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'TableSession' },   // shared tables: this bill was merged into another one (the people were together after all)
    status: { type: String, enum: ['open', 'bill_asked', 'closed'], default: 'open' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },   // the guest who opened this bill: he answers joiners and gets the detailed bill (older bills: the first guest on it)
    customers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],   // everyone who ordered at this table: all of them see the bill
    openedAt: { type: Date, default: Date.now },
    lastOrderAt: { type: Date, default: Date.now },
    blockedGuests: [{ type: mongoose.Schema.Types.ObjectId }],   // guests this bill said "No, and block" to: they can not ask to join it again
    billAskedAt: Date,
    billFor: [{ type: mongoose.Schema.Types.ObjectId }],   // the waiter who served them: the only one told when they first asked for the bill (empty: every waiter on duty)
    billPingAt: Date,   // the guest reminded the shop again (once a minute at most)
    billRemindedAt: Date, billReminds: { type: Number, default: 0 },   // the shop and the waiters are reminded every 5 minutes while the bill waits (jobs/billReminders.js)
    closedAt: Date,
    closedBy: { type: String, enum: ['owner', 'staff', 'auto', 'customer'] },   // customer: a guest freed the table himself once everything was paid
    closedByName: String,   // the waiter who took the money
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
    // A table booking whose deposit is "taken off the bill": the guest's deposit counts toward this visit (services/bookingCredit.js).
    // amount = what he paid when he booked; used = the bill was settled with it; appliedAmount = how much of it the bill really took (a small bill takes less).
    credit: { amount: Number, bookingId: mongoose.Schema.Types.ObjectId, code: String, used: Boolean, appliedAmount: Number },
}, { timestamps: true });

// one open bill per table and party (a table has bill number 1 only, unless the owner switched on shared tables)
tableSessionSchema.index({ tenantId: 1, table: 1, party: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['open', 'bill_asked'] } } });
tableSessionSchema.index({ tenantId: 1, customers: 1, status: 1 });

module.exports = mongoose.model('TableSession', tableSessionSchema);
