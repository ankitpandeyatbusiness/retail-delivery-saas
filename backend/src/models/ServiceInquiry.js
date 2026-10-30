const mongoose = require('mongoose');

// What a customer sent from a service form. Question wording is copied in, so editing the service later changes nothing here.
const inquirySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopService', required: true },
    serviceName: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 20 },
    message: { type: String, maxlength: 1000, default: '' },
    // a field named "type" must be declared as { type: String } or Mongoose takes it for the type of the whole array
    answers: [new mongoose.Schema({
        id: String,
        label: String,
        type: { type: String },
        value: mongoose.Schema.Types.Mixed,    // string, number, boolean, array of strings, or { text } for an address
    }, { _id: false })],
    estimate: { type: Number, default: 0 },    // rupees, only when the service is priced per plate and the guests are known
    // the conversation: the customer's first message, then replies from both sides
    messages: [{ _id: false, from: { type: String, enum: ['customer', 'owner'] }, text: { type: String, maxlength: 1000 }, at: { type: Date, default: Date.now } }],
    ownerUnread: { type: Number, default: 0 },      // customer messages the owner has not opened
    customerUnread: { type: Number, default: 0 },   // owner replies the customer has not opened
    note: { type: String, maxlength: 1000, default: '' },   // private, the owner only
    lastMessageAt: { type: Date, default: Date.now },
    unansweredNotifiedAt: Date,                     // the owner was reminded that the customer's last message is unanswered (once per message)
    status: { type: String, enum: ['new', 'replied', 'quoted', 'confirmed', 'rejected', 'closed'], default: 'new' },
}, { timestamps: true });

inquirySchema.index({ tenantId: 1, status: 1, createdAt: -1 });
inquirySchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('ServiceInquiry', inquirySchema);
