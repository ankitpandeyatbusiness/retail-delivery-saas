const mongoose = require('mongoose');

// One mail waiting to be sent. The worker sends them by priority (1 = first), within the daily limit.
const emailJobSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    to: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
    subject: { type: String, required: true, maxlength: 200 },
    html: { type: String, required: true },
    text: String,
    attachments: [{ _id: false, name: String, content: String }],   // content = base64
    priority: { type: Number, min: 1, max: 3, default: 2 },          // rent bills 1, normal 2, broadcasts 3
    kind: { type: String, maxlength: 40 },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    tries: { type: Number, default: 0 },
    lastError: String,
    sendAfter: { type: Date, default: Date.now },   // while a job is being sent this holds a 5 minute "lease"
    sentAt: Date,
    messageId: String,
}, { timestamps: true });

emailJobSchema.index({ status: 1, priority: 1, sendAfter: 1 });
emailJobSchema.index({ sentAt: 1 }, { partialFilterExpression: { status: 'sent' } });   // the daily count
emailJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 });             // old mails delete themselves

module.exports = mongoose.model('EmailJob', emailJobSchema);