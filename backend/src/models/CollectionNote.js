const mongoose = require('mongoose');

// What a shop said about its unpaid rent ("will pay on Friday"), so a promise is not forgotten. Written by the superadmin, never shown to the shop.
const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    note: { type: String, trim: true, required: true, maxlength: 200 },
    promiseDate: Date,                                                        // the day the shop said it will pay (India day, stored as that day's midnight)
    status: { type: String, enum: ['open', 'paid', 'broken', 'closed'], default: 'open' },
    remindedAt: Date,                                                         // the morning alert for the promise day went out
    by: String,                                                               // which superadmin wrote it
    closedAt: Date,
}, { timestamps: true });

schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.index({ status: 1, promiseDate: 1 });

module.exports = mongoose.model('CollectionNote', schema);
