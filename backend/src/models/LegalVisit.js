const mongoose = require('mongoose');

// How many times a person opened the app since a document version was sent (a "visit" = opening it after at least 30 minutes away).
// The agree screen shows on the SECOND visit, never on the first.
const legalVisitSchema = new mongoose.Schema({
    who: { type: String, enum: ['user', 'admin'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    docKey: { type: String, required: true },
    version: { type: Number, required: true },
    visits: { type: Number, default: 0 },
    lastVisitAt: Date,
}, { timestamps: false });

legalVisitSchema.index({ who: 1, userId: 1, docKey: 1 }, { unique: true });

module.exports = mongoose.model('LegalVisit', legalVisitSchema);
