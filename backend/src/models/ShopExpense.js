const mongoose = require('mongoose');

// What a SHOP spends to run (ingredients, salaries, shop rent, electricity...), written by its owner, so the owner app can show a real profit.
// Not the platform's own expenses (models/Expense.js), and never shown to customers.
const CATEGORIES = ['ingredients', 'salaries', 'shop_rent', 'electricity_gas', 'packaging', 'marketing', 'repairs', 'transport', 'other'];

const schema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    date: { type: Date, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    otherName: { type: String, trim: true, maxlength: 60 },     // what an "other" cost is
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isInteger },
    vendor: { type: String, trim: true, maxlength: 80 },
    note: { type: String, trim: true, maxlength: 200 },
    repeatMonthly: { type: Boolean, default: false },            // counted again every month from `date`, a share for each day
    endsOn: Date,                                                // the last day a repeating cost counts
    createdBy: String,
}, { timestamps: true });

schema.index({ tenantId: 1, date: -1 });

const Model = mongoose.model('ShopExpense', schema);
Model.CATEGORIES = CATEGORIES;
module.exports = Model;
