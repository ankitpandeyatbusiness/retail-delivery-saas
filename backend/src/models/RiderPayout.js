const mongoose = require('mongoose');

// What the shop paid a rider (only when the owner switched on "track payments to riders"). Integer paise.
//   earnings  pay for his deliveries (counts against what he has earned)
//   advance   money given before it was earned (also counts against what he has earned)
//   salary    his fixed salary
//   bonus     a gift on top
// A wrong entry is cancelled (voidedAt), never deleted, so the history stays.
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise: { type: Number, required: true, min: 100, validate: Number.isInteger },
    kind: { type: String, enum: ['earnings', 'advance', 'salary', 'bonus'], default: 'earnings' },
    note: { type: String, maxlength: 200 },
    paidAt: { type: Date, default: Date.now },
    by: { type: { type: String }, id: String, label: String },
    voidedAt: Date,
    voidReason: { type: String, maxlength: 200 },
}, { timestamps: true });

schema.index({ tenantId: 1, riderId: 1, paidAt: -1 });

module.exports = mongoose.model('RiderPayout', schema);
module.exports.KINDS = ['earnings', 'advance', 'salary', 'bonus'];
