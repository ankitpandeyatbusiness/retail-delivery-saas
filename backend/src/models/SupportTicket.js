const mongoose = require('mongoose');

// One help request from a shop owner to the platform (the superadmin team), with its whole conversation.
//   status: open      the platform has to answer (a new request, or the owner wrote again)
//           answered  the platform replied; waiting for the owner
//           resolved  finished (by either side). The owner can reopen it for 7 days.
//   messages[].from: owner | platform | note   (a note is private to the platform team and is NEVER sent to the owner)
const CATEGORIES = ['billing', 'orders', 'app', 'account', 'other'];
const STATUSES = ['open', 'answered', 'resolved'];
const PRIORITIES = ['normal', 'high', 'urgent'];

const messageSchema = new mongoose.Schema({
    from: { type: String, enum: ['owner', 'platform', 'note'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    photos: { type: [String], default: [] },
    by: { type: String, maxlength: 80 },   // who wrote it (the owner's name or phone, or the platform person)
    at: { type: Date, default: Date.now },
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
    number: { type: Number, required: true, unique: true },   // #1042, counted over the whole platform
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // the owner who raised it
    category: { type: String, enum: CATEGORIES, default: 'other' },
    subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    status: { type: String, enum: STATUSES, default: 'open' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    messages: [messageSchema],
    lastFrom: { type: String, enum: ['owner', 'platform'] },
    lastMessageAt: { type: Date, default: Date.now },
    ownerUnread: { type: Boolean, default: false },      // the platform replied and the owner has not opened it yet
    platformUnread: { type: Boolean, default: true },    // the owner wrote and nobody on the team opened it yet
    resolvedAt: Date,
    resolvedBy: { type: String, enum: ['owner', 'platform'] },
    rating: { stars: { type: Number, min: 1, max: 5 }, comment: { type: String, maxlength: 300 }, at: Date },
    context: { appVersion: String, platform: String },
}, { timestamps: true });

supportTicketSchema.index({ tenantId: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, lastMessageAt: -1 });
supportTicketSchema.index({ platformUnread: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
module.exports.PRIORITIES = PRIORITIES;
