const mongoose = require('mongoose');

// The record of every "Switch operator": from whom, to whom, when, by whom, and what the checklist said at that moment.
const operatorSwitchSchema = new mongoose.Schema({
    fromId: { type: mongoose.Schema.Types.ObjectId, ref: 'Operator' },
    fromLabel: String,
    toId: { type: mongoose.Schema.Types.ObjectId, ref: 'Operator', required: true },
    toLabel: String,
    at: { type: Date, default: Date.now },
    by: String,
    note: { type: String, maxlength: 300 },
    checklist: mongoose.Schema.Types.Mixed,
    noticeSent: Boolean,
}, { timestamps: false });

operatorSwitchSchema.index({ at: -1 });

module.exports = mongoose.model('OperatorSwitch', operatorSwitchSchema);
