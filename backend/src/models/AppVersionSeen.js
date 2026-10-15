const mongoose = require('mongoose');

// Which build of a shop's app is talking to the server. One row per (shop, version, build, platform).
// Written (at most once every few minutes per row) when an app request carries the x-app-* headers.
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    version: { type: String, required: true, maxlength: 20 },     // 1.0.0 (what the shop's app shows)
    build: { type: String, default: '', maxlength: 20 },          // native build / version code
    platform: { type: String, default: '', maxlength: 12 },       // android | ios
    osVersion: { type: String, default: '', maxlength: 20 },      // the phone's Android / iOS version
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
}, { versionKey: false });

schema.index({ tenantId: 1, version: 1, build: 1, platform: 1 }, { unique: true });
schema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 180 * 86400 });   // forgotten after 180 days of silence

module.exports = mongoose.model('AppVersionSeen', schema);
