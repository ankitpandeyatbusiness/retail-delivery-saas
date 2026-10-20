const mongoose = require('mongoose');

const { Schema } = mongoose;

// "Refer a friend": a new guest typed a friend's code. The friend gets an offer on the first table order; the referrer gets points
// when that first meal is paid. One row per friend per shop.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    friendId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: String,
    status: { type: String, enum: ['applied', 'rewarded'], default: 'applied' },
    rewardedAt: Date,
    points: Number,
}, { timestamps: true });

schema.index({ tenantId: 1, friendId: 1 }, { unique: true });
schema.index({ tenantId: 1, referrerId: 1, status: 1 });

module.exports = mongoose.model('Referral', schema);
