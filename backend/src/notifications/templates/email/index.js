// The list of mails. An event in events.js points here with  email: '<key>'.
//   audience  platform = the platform's brand (bills), shop = the shop's own brand (mails to its customers)
//   priority  1 = sent first (rent bills), 3 = last (broadcasts)
//   needs     'invoice' = no mail unless the invoice is found
//   load      fetches extra data (and the PDF) before the mail is built
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../../../models/SubscriptionInvoice');
const { renderToBuffer, pdfFileName } = require('../../../services/subscriptionInvoicePdf');
const b = require('./builders');
const businessReport = require('../../../services/businessReport');
const { renderReportPdf, pdfFileName: reportPdfName } = require('../../../services/businessReportPdf');
const PlatformSettings = require('../../../models/PlatformSettings');
const SmsTopup = require('../../../models/SmsTopup');

const withInvoice = (attachPdf) => async ({ tenant, vars }) => {
    if (!vars.invoiceId || !mongoose.isValidObjectId(String(vars.invoiceId))) return {};
    const invoice = await SubscriptionInvoice.findOne({ _id: vars.invoiceId, tenantId: tenant._id }).lean();
    if (!invoice) return {};
    const out = { invoice };
    if (attachPdf) out.attachments = [{ name: pdfFileName(invoice), content: (await renderToBuffer(invoice)).toString('base64') }];
    return out;
};

// the receipt of an SMS top-up: the tax invoice / receipt PDF is attached
const withTopup = async ({ tenant, vars }) => {
    if (!vars.topupId || !mongoose.isValidObjectId(String(vars.topupId))) return {};
    const own = await SmsTopup.exists({ _id: vars.topupId, tenantId: tenant._id });
    if (!own) return {};
    const invoice = await require('../../../services/smsTopupService').ensureInvoice(vars.topupId);   // required here: the top-up service itself sends mail
    if (!invoice) return {};
    return { invoice, attachments: [{ name: pdfFileName(invoice), content: (await renderToBuffer(invoice)).toString('base64') }] };
};

// the monthly report: built here from the numbers, with the PDF attached
const withReport = async ({ tenant, vars }) => {
    if (!/^\d{4}-\d{2}$/.test(String(vars.period || ''))) return {};
    const report = await businessReport.build({ tenantId: tenant._id, range: vars.period });
    const platform = await PlatformSettings.findById('main').select('business').lean();
    const brandName = platform?.business?.appName || platform?.business?.legalName || 'Your app';
    const pdf = await renderReportPdf(report, { shopName: tenant.name, brandName });
    return { report, attachments: [{ name: reportPdfName(tenant.name, vars.period), content: pdf.toString('base64') }] };
};

const REGISTRY = {
    monthly_report: { build: b.monthlyReport, audience: 'platform', priority: 2, load: withReport },
    rent_invoice: { build: b.rentInvoice, audience: 'platform', priority: 1, needs: 'invoice', load: withInvoice(true) },
    payment_receipt: { build: b.paymentReceipt, audience: 'platform', priority: 2, needs: 'invoice', load: withInvoice(true) },   // the paid bill (stamped PAID) is the receipt
    bill_reminder: { build: b.billReminder, audience: 'platform', priority: 1, needs: 'invoice', load: withInvoice(false) },
    shop_paused: { build: b.shopPaused, audience: 'platform', priority: 1, load: withInvoice(false) },
    shop_unpaused: { build: b.shopUnpaused, audience: 'platform', priority: 2 },
    free_ending: { build: b.freeEnding, audience: 'platform', priority: 2 },
    sms_topup_receipt: { build: b.smsTopupReceipt, audience: 'platform', priority: 2, load: withTopup },
    welcome: { build: b.welcome, audience: 'platform', priority: 2 },
    invoice_void: { build: b.invoiceVoid, audience: 'platform', priority: 2, needs: 'invoice', load: withInvoice(false) },
    owner_email_changed: { build: b.ownerEmailChanged, audience: 'platform', priority: 1 },
    email_code: { build: b.emailCode, audience: 'platform', priority: 1 },
    login_alert: { build: b.loginAlert, audience: 'platform', priority: 2 },
    policy_change: { build: b.policyChange, audience: 'platform', priority: 3 },
    refund_decision: { build: b.refundDecision, audience: 'shop', priority: 2 },
    complaint_decision: { build: b.complaintDecision, audience: 'shop', priority: 2 },
    broadcast: { build: b.broadcast, audience: 'platform', priority: 3 },   // a broadcast sets vars.audience = 'shop' when an owner sends it
};

module.exports = { get: (key) => REGISTRY[key], keys: () => Object.keys(REGISTRY) };