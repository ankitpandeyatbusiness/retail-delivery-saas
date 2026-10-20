const mongoose = require('mongoose');

const { Schema } = mongoose;

// A table QR was scanned (in the app's scanner, or from the phone camera's link). For the QR performance report.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    table: { type: String, required: true },
    source: { type: String, enum: ['app', 'link'], default: 'app' },
    key: String,   // who (the address he came from): the same one is not counted twice within 5 minutes
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ tenantId: 1, table: 1, key: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 200 * 86400 });   // old scans are forgotten

module.exports = mongoose.model('TableScan', schema);
