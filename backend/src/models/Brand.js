const mongoose = require('mongoose');

// A brand (like "Savera") groups several branches. Each branch is a normal Tenant with brandId set.
// Phase 1: the brand itself, the branch limit and who made it. Owner, discount and the shared SMS wallet come in later phases.
const brandSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 80 },
    branchLimit: { type: Number, default: 3, min: 1, max: 100 },   // how many branches the supreme admin allows
    notes: { type: String, trim: true, maxlength: 500 },           // private note, never sent to an app
    createdBy: String,
}, { timestamps: true });

module.exports = mongoose.model('Brand', brandSchema);
