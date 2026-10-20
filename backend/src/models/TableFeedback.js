const mongoose = require('mongoose');

const { Schema } = mongoose;

// What a guest tells the OWNER, privately, after the meal. It is never shown to other customers.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    table: String,
    stars: { type: Number, min: 1, max: 5, required: true },
    tags: [String],
    comment: { type: String, maxlength: 300 },
    seenAt: Date,
}, { timestamps: true });

schema.index({ sessionId: 1, userId: 1 }, { unique: true });
schema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('TableFeedback', schema);
