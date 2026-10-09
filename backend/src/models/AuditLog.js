const mongoose = require('mongoose');

// Append-only: there is deliberately no route that edits or deletes these.
const auditSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    actorType: { type: String, enum: ['superadmin', 'owner', 'rider', 'system'], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId },
    actorLabel: String,                                   // superadmin email, or owner user id
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    action: { type: String, required: true },             // e.g. "PUT /api/admin/tenants/:id"
    method: String,
    path: String,
    status: Number,
    params: mongoose.Schema.Types.Mixed,
    query: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed,                    // what was sent (secrets hidden)
    before: mongoose.Schema.Types.Mixed,                  // old values, for edits and deletes
    ip: String,
}, { minimize: false, versionKey: false });

auditSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });   // rows older than 1 year are deleted by MongoDB
auditSchema.index({ tenantId: 1, at: -1 });
auditSchema.index({ actorId: 1, at: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);