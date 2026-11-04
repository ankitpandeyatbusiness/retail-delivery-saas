const mongoose = require('mongoose');

// A brand (like "Savera") groups several branches. Each branch is a normal Tenant with brandId set.
// Phase 1: the brand itself, the branch limit and who made it. Owner, discount and the shared SMS wallet come in later phases.
const brandSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Rent discount for the 2nd branch onward, in percent. Empty or 0 = off. Only the supreme admin sets it, never above the platform cap.
    discountPercent: { type: Number, min: 0, max: 100 },
    // "New branches get a free start" (services/brandFreePool.js): off = a new branch has no free time and is billed from the first full month after go-live; on = one shared free pool for the brand
    freeStart: {
        _id: false,
        on: { type: Boolean, default: false },
        freeOrders: { type: Number, min: 0 },   // empty = the platform's free orders (100)
        freeMonths: { type: Number, min: 0 },   // empty = the platform's free months (2)
        startedAt: Date,                        // the first pooled branch went live
        endedAt: Date,                          // the pool ended: every pooled branch ended its free time at this moment
    },
    smsWalletTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },   // the branch whose SMS wallet is the brand's one shared wallet (the oldest branch, set when first needed)
    ownerPhones: {   // the brand owners: they may be owner of every branch and switch between them. Set by a superadmin.
        type: [String], default: [],
        validate: [{ validator: (a) => a.length <= 3, message: 'At most 3 brand owners' }, { validator: (a) => a.every((p) => /^[6-9]\d{9}$/.test(p)), message: 'Owners need 10-digit mobile numbers' }],
    },
    // what each brand owner chose to be notified about (services/brandNotify.js): { phone, all, ownTenantId, branches: { <tenantId>: true|false } }
    ownerNotify: [{
        _id: false,
        phone: { type: String, required: true },
        all: { type: Boolean, default: false },
        ownTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
        branches: { type: Map, of: Boolean, default: () => ({}) },
    }],
    notes: { type: String, trim: true, maxlength: 500 },           // private note, never sent to an app
    createdBy: String,
}, { timestamps: true });

module.exports = mongoose.model('Brand', brandSchema);
