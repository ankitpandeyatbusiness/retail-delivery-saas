const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // e.g., 'savera'
    name: { type: String, required: true },
    tagline: String,
    colors: {
        primary: String,
        primaryLight: String,
        primaryDark: String,
        background: String,
        text: String,
        error: String,
    },
    heroImages: [String], // Array of Cloudflare R2 URLs
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    androidPackage: String,
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);