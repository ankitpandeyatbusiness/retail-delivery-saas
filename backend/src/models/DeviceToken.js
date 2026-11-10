const mongoose = require('mongoose');

// One phone that can get push messages. A token belongs to one person at a time.
const deviceTokenSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true, maxlength: 4096 },
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    // a BROWSER (platform 'web'): token is the push service's address (endpoint) and these are its keys (services/adapters/webPush.js)
    webKeys: { p256dh: String, auth: String },
    // The owner's phone says whether Soundbox is on. Off = no loud new-order sound from this phone: its pushes go to the
    // app's normal channel instead of the loud "new_orders" one. Phones that never say are treated as on.
    loudAlerts: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

deviceTokenSchema.index({ tenantId: 1, userId: 1 });
deviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 120 * 86400 });   // a phone that is not seen for 120 days is forgotten

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);