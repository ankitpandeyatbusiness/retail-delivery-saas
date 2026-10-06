const mongoose = require('mongoose');

// Atomic counters, e.g. one per shop for order numbers: _id = "order:<tenantId>"
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);