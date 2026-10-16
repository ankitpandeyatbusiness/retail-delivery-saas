const mongoose = require('mongoose');

const { Schema } = mongoose;

// One legal document (terms, agreement, privacy policy). The supreme admin edits the DRAFT and presses "Send new version";
// that saves a frozen copy in `versions`, and people are asked to agree to it. Old versions are never changed or deleted.
const versionSchema = new Schema({
    no: { type: Number, required: true },
    title: String,
    body: String,                       // the text as sent, with the names already filled in
    summary: { type: String, trim: true, maxlength: 300 },   // what changed, shown to people
    askWhen: { type: String, enum: ['now', 'free_ends'], default: 'now' },   // owners: ask at the second visit, or only when the free period has ended
    publishedAt: { type: Date, default: Date.now },
    publishedBy: String,
    operatorName: String,               // whose name was in force
}, { _id: false });

const legalDocumentSchema = new Schema({
    key: { type: String, required: true, unique: true },     // operator_agreement | team_terms | owner_terms | rider_terms | customer_terms | privacy
    audience: { type: String, enum: ['partner', 'team', 'owner', 'rider', 'customer'], required: true },
    draft: { _id: false, title: String, body: String, updatedAt: Date, updatedBy: String },
    currentVersion: { type: Number, default: 0 },
    versions: [versionSchema],
}, { timestamps: true });

module.exports = mongoose.model('LegalDocument', legalDocumentSchema);
