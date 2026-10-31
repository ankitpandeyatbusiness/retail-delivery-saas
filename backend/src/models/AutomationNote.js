const mongoose = require('mongoose');

// "Already reminded": one row per reminder, so an automatic reminder repeats at its own pace and never twice at once (services/automations.js claim()).
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    at: { type: Date, required: true },
    n: { type: Number, default: 1 },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });
schema.index({ at: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });   // forgotten after two weeks

module.exports = mongoose.model('AutomationNote', schema);
