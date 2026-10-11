const mongoose = require('mongoose');

// Changes how ONE event is delivered, without a deploy. Only the fields you set override the defaults
// in notifications/events.js. No tenantId = every shop. With a tenantId = that shop only (it wins).
const notificationRuleSchema = new mongoose.Schema({
    eventKey: { type: String, required: true, trim: true, maxlength: 60 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    enabled: Boolean,                                   // false = this event sends nothing at all
    channels: { type: [{ type: String, enum: ['inapp', 'push', 'sms'] }], default: undefined },
    alsoPush: Boolean,
    escalateSmsAfterSec: { type: Number, min: 0, max: 86400 },
}, { timestamps: true });

notificationRuleSchema.index({ eventKey: 1, tenantId: 1 }, { unique: true });

module.exports = mongoose.model('NotificationRule', notificationRuleSchema);