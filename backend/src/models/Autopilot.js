const mongoose = require('mongoose');

// One shop's Autopilot: which automatic messages are on, how often, in which language. One row per shop.
// The recommended values are the defaults here; "Reset to recommended" writes them back (services/autopilot.js RECOMMENDED).
const autopilotSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    on: {
        welcome: { type: Boolean, default: false },       // after a new customer's first order
        thanks: { type: Boolean, default: false },        // after a delivery
        winback: { type: Boolean, default: false },       // customers who stopped ordering (a short, capped sequence)
        mealtime: { type: Boolean, default: false },      // "lunch time? your usual" at the hour a regular customer usually orders
        festival: { type: Boolean, default: false },      // a festival greeting
        dailySummary: { type: Boolean, default: false },  // to the OWNER: how today went
        weeklyDigest: { type: Boolean, default: false },  // to the OWNER on Monday: how last week went
    },
    frequency: { type: String, enum: ['gentle', 'normal', 'pushy'], default: 'gentle' },
    language: { type: String, enum: ['en', 'hinglish', 'hi', 'mixed'], default: 'hinglish' },
    maxDiscount: { type: Number, default: 10, min: 0, max: 50 },   // % off in the win-back offer step. 0 = no offer, only reminders
    quietFrom: { type: Number, default: 21, min: 0, max: 23 },     // no promotional message from this hour (India time) ...
    quietTo: { type: Number, default: 9, min: 0, max: 23 },        // ... until this hour
    summaryHour: { type: Number, default: 22, min: 0, max: 23 },   // when the owner's daily summary arrives
    custom: { type: mongoose.Schema.Types.Mixed, default: {} },    // the owner's own wording: { kind: { title, body } } (any language)
    platformPaused: { type: Boolean, default: false },             // the superadmin switched this shop's Autopilot off
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('Autopilot', autopilotSchema);
