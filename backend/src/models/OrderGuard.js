const mongoose = require('mongoose');

// One short-lived row per "same cart from the same person". It stops a double tap creating two orders.
// The row is kept 30 seconds (MongoDB deletes it); orderService refuses a repeat inside 10 seconds.
const orderGuardSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },   // hash of shop + person + items + options + total
    at: { type: Date, required: true },
}, { versionKey: false });

orderGuardSchema.index({ at: 1 }, { expireAfterSeconds: 30 });

module.exports = mongoose.model('OrderGuard', orderGuardSchema);