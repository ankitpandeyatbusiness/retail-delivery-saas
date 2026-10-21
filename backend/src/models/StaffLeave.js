const mongoose = require('mongoose');

// Leave a cook or a waiter asks for. The owner approves or rejects it. An approved leave becomes a day off in the person's calendar
// (Staff.holidays, with leaveId), so alerts skip those days (services/staffLeave.js). A plain holiday needs no approval.
const staffLeaveSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    role: { type: String, enum: ['kitchen', 'waiter'] },
    from: { type: String, required: true },   // India dates, both ends included
    to: { type: String, required: true },
    days: Number,
    reason: { type: String, maxlength: 200 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedAt: Date,
    decidedNote: { type: String, maxlength: 200 },
}, { timestamps: true });

staffLeaveSchema.index({ tenantId: 1, status: 1, from: 1 });
staffLeaveSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('StaffLeave', staffLeaveSchema);
