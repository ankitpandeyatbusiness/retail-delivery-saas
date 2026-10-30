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
    answers: [{
        _id: false,
        id: String,
        label: String,
        type: String,
        value: mongoose.Schema.Types.Mixed,    // string, number, boolean, array of strings, or { text } for an address
    }],
    estimate: { type: Number, default: 0 },    // rupees, only when the service is priced per plate and the guests are known
    status: { type: String, enum: ['new', 'replied', 'quoted', 'confirmed', 'rejected', 'closed'], default: 'new' },
}, { timestamps: true });

inquirySchema.index({ tenantId: 1, status: 1, createdAt: -1 });
inquirySchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('ServiceInquiry', inquirySchema);
