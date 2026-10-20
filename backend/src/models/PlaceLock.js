const mongoose = require('mongoose');

// One short-lived row while a customer's order is being placed, so two orders placed at the very same moment cannot both pass the limits
// (waiting pickups, deliveries on the way, cash owed together). MongoDB deletes expired rows.
const placeLockSchema = new mongoose.Schema({
    _id: { type: String },   // shop + person
    expireAt: { type: Date, required: true },
}, { versionKey: false });
placeLockSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PlaceLock', placeLockSchema);
