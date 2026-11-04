const mongoose = require('mongoose');

// "I dealt with this by hand": a superadmin marks one item of a Needs attention list as handled, with a note.
// The thing itself is never changed (a failed refund stays failed, a bill stays unpaid): the item only leaves the list.
// It can be taken back within 10 minutes (services/handledMarks.js); the mark is then kept as undone, never deleted.
const schema = new mongoose.Schema({
    scope: { type: String, enum: ['money', 'orders', 'platform'], required: true },
    kind: { type: String, required: true },          // which list: refund_failed, unmatched, order_problem ...
    refId: { type: String, required: true },         // the record inside that list (an order problem: "<orderId>:<code>")
    title: { type: String, default: '' },            // what it was, saved so the Handled list still reads well later
    note: { type: String, default: '', maxlength: 200 },
    by: { type: String, default: '' },
    undoneAt: Date,
    undoneBy: String,
}, { timestamps: true });

schema.index({ kind: 1, refId: 1, undoneAt: 1 });
schema.index({ scope: 1, createdAt: -1 });

module.exports = mongoose.model('HandledMark', schema);
