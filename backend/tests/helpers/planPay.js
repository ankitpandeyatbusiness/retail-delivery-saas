// A paid plan payment for tests (the platform's only invoices now: everything is prepaid).
const crypto = require('crypto');
const PlanPayment = require('../../src/models/PlanPayment');

// baseRs = the plan price before GST, in rupees
module.exports.paidPlan = (tenantId, { baseRs = 1000, gstPercent = 18, paidAt = new Date(), invoiceNo, kind = 'renew', to = 'growth' } = {}) => {
    const taxablePaise = Math.round(baseRs * 100);
    const gstPaise = Math.round((taxablePaise * gstPercent) / 100);
    return PlanPayment.create({
        tenantId, kind, to, months: 1, quote: { taxablePaise, gstPaise, gstPercent }, payablePaise: taxablePaise + gstPaise, status: 'paid', paidAt,
        paymentId: 'pay_' + crypto.randomBytes(6).toString('hex'), invoice: { invoiceNo: invoiceNo || 'PL/' + crypto.randomBytes(3).toString('hex'), issueDate: paidAt },
    });
};
