const mongoose = require('mongoose');

// A rider asks his shop for days off. The owner approves or rejects. Dates are India days, "YYYY-MM-DD", both ends included.
const riderLeaveSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    riderUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    riderName: { type: String, trim: true, maxlength: 80 },
    from: { type: String, required: true },
    to: { type: String, required: true },
    days: { type: Number, required: true, min: 1 },
    reason: { type: String, trim: true, maxlength: 200 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedAt: Date,
    decidedNote: { type: String, trim: true, maxlength: 200 },
}, { timestamps: true });

riderLeaveSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
riderLeaveSchema.index({ tenantId: 1, riderUserId: 1, from: 1 });

module.exports = mongoose.model('RiderLeave', riderLeaveSchema);
