const mongoose = require('mongoose');

const { Schema } = mongoose;

// A guest at a table asks for something ("call the waiter", water, cutlery, clean the table). The owner's Home lists the open ones.
const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession' },
    table: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: { type: String, enum: ['waiter', 'water', 'cutlery', 'clean', 'other', 'share'], required: true },
    text: { type: String, maxlength: 120 },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    doneAt: Date,
    doneBy: { type: String, enum: ['owner', 'staff', 'auto'] },
    doneByName: String,
}, { timestamps: true });

schema.index({ tenantId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('TableRequest', schema);
