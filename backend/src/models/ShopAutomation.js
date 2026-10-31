const mongoose = require('mongoose');

// One shop's automation choices (services/automations.js): what the system does by itself, and after how long. 0 or false = the owner does it by hand.
// A shop that never opened the Automations screen has no row: the recommended values are used (DEFAULTS in the service).
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    reservationAutoAllowMin: Number,    // a paid reservation nobody answered is allowed after this many minutes
    reservationNoShowMin: Number,       // a reservation not marked seated is marked no-show this long after its start
    depositAutoAdjust: Boolean,         // the deposit is marked taken off the bill when the guest's table bill is closed
    pickupNotCollectedMin: Number,      // a ready pickup order is marked not collected this long after its pickup window ended (30 at least)
    cancelRequestDeclineMin: Number,    // a table guest's request to cancel a dish already being made is declined after this long
    inquiryCloseDays: Number,           // an answered inquiry with no new message is ended after this many days
    stageAlerts: Boolean,               // alerts for an order that stays too long in one stage
    cashLimitReminders: Boolean,        // reminders while a rider holds more cash than the limit
    leaveReminders: Boolean,            // reminders for a leave request nobody answered
    kitchenProblemReminders: Boolean,   // reminders for a kitchen problem nobody answered
    complaintReminders: Boolean,        // repeat reminders for a complaint nobody answered
    autoApproveLeave: Boolean,          // a leave request nobody answered for 2 hours is approved
}, { timestamps: true });

module.exports = mongoose.model('ShopAutomation', schema);
