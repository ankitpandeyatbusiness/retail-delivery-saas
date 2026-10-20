const mongoose = require('mongoose');

const { Schema } = mongoose;
const { maskPhone } = require('../utils/phoneHash');

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
    // items sold by weight or volume: what the customer asked for (the pack price is unitPrice, quantity is 1)
    measure: { _id: false, qty: Number, unit: String, label: String },
    note: String,
}, { _id: false });

const orderSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderNo: { type: Number, required: true },              // shown to people, e.g. #1042
    idempotencyKey: { type: String },                       // stops a double-tap creating two orders

    status: {
        type: String,
        enum: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'undelivered'],
        default: 'placed',
    },
    orderType: { type: String, enum: ['delivery', 'pickup', 'dine_in'], required: true },

    items: { type: [lineSchema], validate: (v) => v.length > 0 },

    pricing: {
        subtotal: Number,
        discount: { type: Number, default: 0 },
        couponCode: String,
        offerKind: String, offerLabel: String, offerDiscount: { type: Number, default: 0 },   // the table offer this order got (welcome, regular, happy hour); its rupees are inside `discount`
        pointsUsed: { type: Number, default: 0 },       // loyalty points spent on this order (their rupees are inside `discount`)
        pointsDiscount: { type: Number, default: 0 },
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
        paidAt: Date,
        paymentId: String,   // the Razorpay payment id
        paidAtDoor: Boolean, // a Cash on delivery order that was paid by QR at the door
        settledAt: Date,     // a dine in round paid when the owner settled the table bill
        settledVia: String,  // cash | upi (at the counter)
    },

    customer: { name: String, phone: String, phoneHash: String, deleted: Boolean },   // deleted = he deleted his account
    address: {
        label: String, name: String, phone: String, line1: String, line2: String,
        landmark: String, city: String, pincode: String, latitude: Number, longitude: Number,
    },
    tableNo: String,
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession' },   // the table bill this round belongs to (dine in)
    scheduledFor: Date,
    pickupNotified: { waitingAt: Date, overAt: Date, noShowAt: Date },   // the reminders for a pickup order, each sent once (jobs/pickupReminders.js)
    pickupChanges: { type: Number, default: 0 },            // how many times the customer asked to move his pickup time
    pickupRequest: { from: Date, to: Date, at: Date },
    pickupClaim: { kind: String, at: Date, snoozeUntil: Date },   // at his pickup time the customer says: I collected it | I do not want it (the owner answers)
    cancelRequest: { at: Date, note: String },                   // a table customer asks the shop to cancel a round that is already being made     // a pickup time he asked for, waiting for the shop to say yes or no
    pickupUntil: Date,                                      // end of the pickup time window
    note: String,                                           // special instructions for the whole order
    etaMin: Number,

    // Phase 6: delivery by a rider. riderId is the rider's User id. Money here is integer paise.
    delivery: {
        riderId: { type: Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['assigned', 'accepted', 'picked_up', 'delivered', 'rejected'] },   // assigned = offered, waiting for the rider
        assignedAt: Date,
        acceptedAt: Date,
        pickedUpAt: Date,
        deliveredAt: Date,
        offerExpiresAt: Date,
        pinRequired: { type: Boolean, default: false },   // shop setting copied when the rider is assigned
        pinAttempts: { type: Number, default: 0 },
        arrivedAt: Date,   // the rider tapped "I have arrived" at the customer
        plannedSec: Number,   // the time allowed for the journey, saved when the food is collected (services/deliveryPlan.js)
        dueAt: Date,          // collected + the time allowed
        lateWarnedAt: Date,   // the rider and the shop were warned that the order will be cancelled soon (services/lateDelivery.js)
        dueRefined: Boolean,  // the time allowed was replaced by the first real route after pickup (services/deliveryPlan.js)
        // where the rider was when he marked it delivered, and how far from the customer's pin (far / noGps are shown to the owner)
        deliveredPoint: { _id: false, lat: Number, lng: Number, distanceM: Number, far: Boolean, noGps: Boolean, at: Date },
        // a Cash on delivery customer who pays by QR at the door (services/doorPayment.js)
        doorQr: { _id: false, qrId: String, imageUrl: String, upiString: String, amountPaise: Number, expiresAt: Date, createdAt: Date, paidAt: Date, closedAt: Date },
        arrivingNotifiedAt: Date,   // the "arriving soon" push was sent (once per order)
        reachedNotifiedAt: Date,    // the "reached" push was sent (once per order)
        // the offer to ALL free riders at once (automatic mode)
        broadcast: { active: Boolean, startedAt: Date, expiresAt: Date, endedAt: Date, endReason: String, reoffer: Boolean },   // reoffer: opened again for a rider who came on duty later
        problems: [{ _id: false, at: Date, reason: String, note: String }],   // reported by the rider
        cashCollectedPaise: { type: Number, default: 0 },
        // the rider's photo of the food handed over: proof of a safe delivery. Optional. Shown to the customer, the owner and the superadmin.
        proof: { _id: false, url: String, at: Date, mediaId: { type: Schema.Types.ObjectId, ref: 'Media' } },
        earnPaise: { type: Number, default: 0 },   // what the rider earned for this delivery (whole paise). Information only.
        offers: [{
            _id: false,
            riderId: { type: Schema.Types.ObjectId, ref: 'User' },
            offeredAt: Date,
            expiresAt: Date,
            by: String,   // system, owner or superadmin
            result: { type: String, enum: ['offered', 'accepted', 'rejected', 'timeout', 'cancelled', 'taken'] },   // taken = another rider accepted first
            at: Date,
        }],
        riderHistory: [{
            _id: false,
            riderId: { type: Schema.Types.ObjectId, ref: 'User' },
            assignedAt: Date,
            removedAt: Date,
            reason: String,
            by: { type: { type: String }, id: String, label: String },
        }],
    },
    deliveryRating: {                                       // separate from the dish ratings
        rating: { type: Number, min: 1, max: 5 },
        tags: [String],
        comment: { type: String, maxlength: 300 },
        ratedAt: Date,
    },

    statusHistory: [{
        _id: false,
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId },                // who changed it
        byType: String,                                     // customer, owner, rider, superadmin, system
        byLabel: String,                                    // readable name, e.g. a phone number or email
        note: String,
    }],
    stuck: { stage: String, ownerAt: Date, adminAt: Date },   // late-order alerts already sent (internal)
    unacceptedReminders: { type: [Number], default: undefined },   // the "please accept" reminders already sent to the owner, in minutes (3, 6)
    cancelReason: String,
    cancelledBy: { type: String, enum: ['customer', 'shop', 'rider', 'admin', 'system'] },
    // billable = this order EARNED MONEY for the shop, so it counts for the free period and the monthly rent. Set once, by billableService.
    billing: { billable: Boolean, at: Date, reason: String },
    // how a cancel ended: who, why, and the money (online orders only; whole paise)
    cancel: { by: String, reasonCode: String, keptPaise: Number, refundPaise: Number },
    // the owner marked it "not delivered" (customer, shop or rider at fault)
    undelivered: { reasonCode: String, note: String, at: Date, by: String, keptPaise: Number, refundPaise: Number },
    deliveredAt: Date,
    ratedAt: Date,
    // the kitchen screen (services/kitchenService.js): who started cooking and who marked it ready, and a problem the cook told the shop
    kitchen: {
        _id: false,
        startedAt: Date, startedBy: { type: Schema.Types.ObjectId }, startedByName: String,
        readyAt: Date, readyBy: { type: Schema.Types.ObjectId }, readyByName: String,
        problem: { _id: false, kind: String, note: String, at: Date, byName: String },
        nudgedAt: Date, lateNudgedAt: Date, serveNudgedAt: Date,   // the nudges already sent for this order, each once (jobs/staffNudges.js)
    },
    // something happened that the owner has to see once (services/orderLook.js); seenAt is set when he opens the order
    needsLook: { reason: String, urgent: Boolean, at: Date, seenAt: Date },
}, { timestamps: true });

orderSchema.index({ tenantId: 1, orderNo: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });   // late-order watcher
orderSchema.index({ tenantId: 1, status: 1, deliveredAt: 1 });   // reports
orderSchema.index({ tenantId: 1, 'billing.at': 1 }, { partialFilterExpression: { 'billing.billable': true } });   // monthly billing count
orderSchema.index({ tenantId: 1, 'delivery.riderId': 1, status: 1 });   // a rider's orders
orderSchema.index({ 'delivery.offerExpiresAt': 1 }, { partialFilterExpression: { 'delivery.status': 'assigned' } });   // offer timeout job
orderSchema.index({ 'delivery.broadcast.expiresAt': 1 }, { partialFilterExpression: { 'delivery.broadcast.active': true } });   // broadcast timeout job
orderSchema.index({ createdAt: 1 }, { partialFilterExpression: { status: 'placed' } });   // auto-cancel job
orderSchema.index({ tenantId: 1, 'customer.phoneHash': 1, status: 1 });   // returning-customer and coupon checks (by hash)
orderSchema.index({ tenantId: 1, 'customer.phone': 1, status: 1 });   // returning-customer and coupon checks
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
        delete ret.stuck;
        delete ret.unacceptedReminders;
        if (ret.customer?.deleted) {   // he deleted his account: hide his details (invoice PDFs keep the real data)
            ret.customer = { name: 'Deleted customer', phone: maskPhone(ret.customer.phone), deleted: true };
            if (ret.address) ret.address = { ...ret.address, name: 'Deleted customer', phone: maskPhone(ret.address.phone) };
        } else if (ret.customer) {
            delete ret.customer.phoneHash;   // never sent to any app
        }
        if (ret.delivery) {   // internal details, never sent as plain order JSON
            delete ret.delivery.offers;
            delete ret.delivery.broadcast;
            delete ret.delivery.riderHistory;
            delete ret.delivery.pinAttempts;
            delete ret.delivery.earnPaise;   // the rider's pay is not for the customer
            delete ret.delivery.problems;
        }
        return ret;
    },
});

module.exports = mongoose.model('Order', orderSchema);