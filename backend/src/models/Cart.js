const mongoose = require('mongoose');

// A customer's cart, kept on the server so the phone app and the website show the same one (web phase 12).
// One per person per shop. The lines are what the app keeps on the device (the prices shown are only a preview: the server quote at checkout is the truth).
const cartSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lines: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

cartSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
cartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 86400 });   // a cart nobody touched for 90 days is forgotten

module.exports = mongoose.model('Cart', cartSchema);
