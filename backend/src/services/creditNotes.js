// Issues the credit note for a bill that was cancelled after it was issued. Safe to call twice (one note per bill).
const CreditNote = require('../models/CreditNote');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const invoicing = require('./platformInvoicing');

async function issueFor(inv, { reason, by, now = new Date() } = {}) {
    const found = await CreditNote.findOne({ originalInvoiceId: inv._id }).lean();
    if (found) return found;
    const num = await invoicing.allocate('CN', { now });
    try {
        const note = await CreditNote.create({
            tenantId: inv.tenantId,
            invoiceNo: num.invoiceNo,
            issueDate: now,
            originalInvoiceId: inv._id,
            originalInvoiceNo: inv.invoiceNo,
            originalIssueDate: inv.issueDate,
            reason: reason || inv.voidReason,
            period: inv.period,
            lineItems: inv.lineItems,
            baseAmount: inv.baseAmount,
            gstPercent: inv.gstPercent,
            gstAmount: inv.gstAmount,
            placeOfSupply: inv.placeOfSupply,
            taxSplit: inv.taxSplit,
            reverseCharge: inv.reverseCharge,
            total: inv.total,
            seller: inv.seller,
            buyer: inv.buyer,
            createdBy: by,
        });
        await SubscriptionInvoice.updateOne({ _id: inv._id }, { $set: { creditNoteId: note._id } });
        return note.toObject();
    } catch (e) {
        await num.undo();
        if (e.code === 11000) return CreditNote.findOne({ originalInvoiceId: inv._id }).lean();
        throw e;
    }
}

module.exports = { issueFor };
