const mongoose = require('mongoose');

// Money YOU spend to run the platform (hosting, SMS provider, staff...). Used for the profit and loss screen.
const CATEGORIES = ['hosting', 'sms_provider', 'payment_gateway_fees', 'staff', 'marketing', 'tools', 'taxes', 'other'];

const expenseSchema = new mongoose.Schema({
    date: { type: Date, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isInteger },
    vendor: { type: String, trim: true, maxlength: 80 },
    note: { type: String, trim: true, maxlength: 200 },
    repeatMonthly: { type: Boolean, default: false },   // counted again every month from `date`
    endsOn: Date,                                       // last day a repeating cost counts
    createdBy: String,
}, { timestamps: true });

expenseSchema.index({ date: -1 });

const Expense = mongoose.model('Expense', expenseSchema);
Expense.CATEGORIES = CATEGORIES;
module.exports = Expense;
