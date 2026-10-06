const mongoose = require('mongoose');

const { Schema } = mongoose;

// Everything below is a SNAPSHOT taken at order time, so later menu or price changes never alter old orders.
const lineSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    image: String,
    isVeg: Boolean,
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },   // base + chosen options
    lineTotal: { type: Number, required: true, min: 0 },
    gstRate: Number,
    tax: { type: Number, default: 0 },
    selections: [{
        _id: false,
        groupId: String, groupName: String, optionId: String, name: String, price: Number,
    }],
    note: String,
}, { _id: false });

const orderSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderNo: { type: Number, required: true },              // shown to people, e.g. #1042
    idempotencyKey: { type: String },                       // stops a double-tap creating two orders

    status: {
        type: String,
        enum: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'placed',
    },
    orderType: { type: String, enum: ['delivery', 'pickup', 'dine_in'], required: true },

    items: { type: [lineSchema], validate: (v) => v.length > 0 },

    pricing: {
        subtotal: Number,
        discount: { type: Number, default: 0 },
        couponCode: String,
        deliveryFee: { type: Number, default: 0 },
        packagingCharge: { type: Number, default: 0 },
        taxMode: String,          // none / inclusive / exclusive
        taxPercent: Number,
        tax: { type: Number, default: 0 },
        tip: { type: Number, default: 0 },
        total: { type: Number, required: true },
    },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    seller: { name: String, gstin: String, fssai: String },   // copied at order time, for the invoice

    payment: {
        method: { type: String, enum: ['cod', 'upi', 'card', 'wallet'], required: true },
        status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    },

    customer: { name: String, phone: String },
    address: {
        label: String, name: String, phone: String, line1: String, line2: String,
        landmark: String, city: String, pincode: String, latitude: Number, longitude: Number,
    },
    tableNo: String,
    scheduledFor: Date,
    note: String,                                           // special instructions for the whole order
    etaMin: Number,

    statusHistory: [{
        _id: false,
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId },                // who changed it
        note: String,
    }],
    cancelReason: String,
    cancelledBy: { type: String, enum: ['customer', 'shop'] },
    deliveredAt: Date,
    ratedAt: Date,
}, { timestamps: true });

orderSchema.index({ tenantId: 1, orderNo: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index(
    { tenantId: 1, userId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

orderSchema.set('toJSON', {
    transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.idempotencyKey;
        return ret;
    },
});

module.exports = mongoose.model('Order', orderSchema);