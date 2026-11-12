const mongoose = require('mongoose');

// A person who tried the public demo and left their details ("Did you like the demo?"). The supreme admin calls them (superadmin app > Demo leads).
const demoLeadSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 80 },
    shopName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
    language: { type: String, enum: ['en', 'hi', 'bho', 'mr', 'gu', 'bn'], default: 'en' },
    stories: { type: [String], default: [] },   // the stories they finished
    status: { type: String, enum: ['new', 'called'], default: 'new' },
    calledAt: Date,
    note: { type: String, trim: true, maxlength: 500 },   // private, written by the team
    ipHash: { type: String },   // never the address itself
    times: { type: Number, default: 1 },   // the same number asked again: counted here, not listed twice
}, { timestamps: true });

demoLeadSchema.index({ createdAt: -1 });
demoLeadSchema.index({ phone: 1 });
demoLeadSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DemoLead', demoLeadSchema);
