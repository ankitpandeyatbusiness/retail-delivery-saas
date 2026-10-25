const mongoose = require('mongoose');

// "I'm with them": a guest at a shared table asks to join the bill of the person who is already seated. That person says yes or no in the app.
// No answer in a couple of minutes (expiresAt) and the newcomer is offered his own bill instead, so nobody is stuck. (services/tableBill.js)
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    table: { type: String, required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TableSession', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // the newcomer
    status: { type: String, enum: ['pending', 'approved', 'joined', 'denied', 'expired'], default: 'pending' },   // approved = they said yes, a 4-digit PIN is on their screen; joined = the newcomer entered it
    pin: String, pinExpiresAt: Date, pinTries: { type: Number, default: 0 }, joinedAt: Date,
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    answeredAt: Date,
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

schema.index({ tenantId: 1, sessionId: 1, status: 1 });
schema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('TableJoin', schema);
