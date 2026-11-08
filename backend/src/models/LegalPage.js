const mongoose = require('mongoose');

// An edited terms / privacy / About Us text. Nothing here until the supreme admin presses Publish: until then the built-in text in
// services/legalTemplates.js is shown. Publishing makes the draft the current text everywhere at once. Nobody has to agree to it.
const versionSchema = new mongoose.Schema({
    no: { type: Number, required: true },
    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, maxlength: 60000 },
    publishedAt: { type: Date, default: Date.now },
    publishedBy: { type: String, maxlength: 120 },
}, { _id: false });

const legalPageSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    draft: { type: new mongoose.Schema({ title: String, body: String, updatedAt: Date, updatedBy: String }, { _id: false }), default: undefined },
    versions: { type: [versionSchema], default: [] },    // every published text, oldest first (the last 50 are kept)
    currentNo: { type: Number, default: 0 },             // 0 = nothing published: the built-in text is shown
}, { timestamps: true });

module.exports = mongoose.models.LegalPage || mongoose.model('LegalPage', legalPageSchema);
