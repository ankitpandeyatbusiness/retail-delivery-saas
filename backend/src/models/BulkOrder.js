const mongoose = require('mongoose');

const { Schema } = mongoose;

// A bulk order: a company or a family asks for a large quantity, the owner sends a quote, the customer pays an advance, the shop makes it.
//   requested -> quoted -> confirmed (advance paid) -> preparing -> ready -> out_for_delivery -> delivered -> completed (balance paid)
//   and: declined (by the shop), cancelled (by the customer), expired (the quote ran out)
// Everything is priced on the server. Money is kept as rupees with 2 decimals in `pricing`, and as whole PAISE in the advance / balance.
const lineSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    image: String,
    isVeg: Boolean,
    quantity: { type: Number, required: true, min: 1 },
    listPrice: Number,        // one piece at the menu price (with the chosen options), before the bulk price
    unitPrice: { type: Number, required: true, min: 0 },
    bulkApplied: { type: Boolean, default: false },
    lineTotal: { type: Number, required: true, min: 0 },
    gstRate: Number,
    gstInclusive: Boolean,
    tax: { type: Number, default: 0 },
    selections: { type: [Schema.Types.Mixed], default: undefined },
    note: String,
});

const pricingSchema = new Schema({
    subtotal: Number, discount: { type: Number, default: 0 }, deliveryFee: { type: Number, default: 0 }, packagingCharge: { type: Number, default: 0 },
    tax: { type: Number, default: 0 }, taxOnTop: { type: Number, default: 0 }, taxIncluded: { type: Number, default: 0 }, taxMode: String, taxPercent: Number,
    total: Number,
}, { _id: false });

const schema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['requested', 'quoted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'declined', 'cancelled', 'expired'], default: 'requested' },

    fulfilment: { type: String, enum: ['delivery', 'pickup'], required: true },
    when: { type: Date, required: true },                   // the pickup or delivery time the customer asked for
    address: { type: Schema.Types.Mixed },                  // a copy of the saved address (delivery only)
    distanceKm: Number,
    contact: { _id: false, name: String, phone: String, onSitePhone: String, company: String, gstin: String },
    cutlery: { type: Boolean, default: false },
    packaging: { type: String, enum: ['boxes', 'trays', 'any'], default: 'any' },
    note: { type: String, maxlength: 500 },
    gstMode: String,                                        // the shop's GST mode when it was asked: lines without their own switch follow it

    lines: [lineSchema],                                    // what the customer asked for, priced
    pricing: pricingSchema,                                 // the estimate the customer saw

    quote: {
        _id: false,
        version: Number,
        lines: [lineSchema],
        pricing: pricingSchema,
        advancePercent: Number,
        fullRefundHours: Number,   // the rule the customer saw: cancel at least this long before the time and the whole advance goes back
        advancePaise: Number,
        balancePaise: Number,
        validUntil: Date,
        note: { type: String, maxlength: 500 },
        quotedAt: Date,
    },
    quoteCount: { type: Number, default: 0 },
    confirmedAt: Date,
    cancelledBy: { type: String, enum: ['customer', 'owner'] },
    cancelReason: { type: String, maxlength: 300 },
    // money, copied here from BulkPayment so a screen can show it: the advance paid, and what happened to it when the order ended
    payment: { _id: false, advancePaise: Number, advancePaymentId: Schema.Types.ObjectId, paidAt: Date, advanceKept: Boolean, refundDuePaise: Number, refundPaise: Number, refundStatus: String },
    changeNote: { type: String, maxlength: 500 },           // what the customer asked to be changed in the last quote
    declineReason: { type: String, maxlength: 300 },
    ownerNote: { type: String, maxlength: 1000, default: '' },   // private, the owner only
    history: [{ _id: false, status: String, by: String, note: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.index({ tenantId: 1, userId: 1, createdAt: -1 });
schema.index({ code: 1, tenantId: 1 }, { unique: true });

module.exports = mongoose.model('BulkOrder', schema);
