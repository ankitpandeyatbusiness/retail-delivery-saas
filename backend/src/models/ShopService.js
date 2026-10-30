const mongoose = require('mongoose');

// One thing a shop offers besides the menu: bulk orders, tiffin, party booking, or anything the owner makes up.
// The questions the customer is asked are stored on the service itself, so the owner can change them freely.
const questionSchema = new mongoose.Schema({
    id: { type: String, required: true },          // stable key; answers are stored against it
    type: { type: String, required: true },        // text | longtext | number | date | time | yesno | choice | multichoice | phone | address | photo
    label: { type: String, required: true, maxlength: 200 },
    hint: { type: String, maxlength: 200, default: '' },
    required: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    recommended: { type: Boolean, default: false }, // came from our recommended set (the owner's own are false)
    options: [{ type: String, maxlength: 80 }],     // choice and multichoice
    min: Number,                                    // number
    max: Number,
}, { _id: false });

const shopServiceSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, default: 'custom' },     // bulk | tiffin | party | other | custom: picks the recommended question set
    name: { type: String, required: true, trim: true, maxlength: 80 },
    icon: { type: String, default: 'sparkles-outline' },
    description: { type: String, maxlength: 1000, default: '' },
    photos: [{ type: String }],
    priceType: { type: String, enum: ['per_plate', 'fixed', 'from', 'per_month', 'quote'], default: 'quote' },
    price: { type: Number, min: 0, default: 0 },   // rupees
    minGuests: { type: Number, min: 0, default: 0 },
    noticeHours: { type: Number, min: 0, default: 0 },
    bullets: [{ type: String, maxlength: 120 }],
    quickTexts: [{ type: String, maxlength: 160 }],   // chips the customer taps to fill the message
    quickReplies: [{ type: String, maxlength: 240 }], // texts the owner taps to answer
    questions: [questionSchema],
    isActive: { type: Boolean, default: true },    // the on/off switch
    sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

shopServiceSchema.index({ tenantId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('ShopService', shopServiceSchema);
