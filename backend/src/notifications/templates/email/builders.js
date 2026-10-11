// One builder per mail. Each takes its data plus ctx (brand, footer, ...) and returns { subject, html, text }.
// Change the words of a mail HERE.
const { compose, rs, day, dateTime, monthLabel } = require('./layout');

const inv = (v) => v.invoice || {};
const shop = (v) => v.shopName || 'your shop';
const panelButton = (v, label) => (v.ctx?.panelUrl ? { label, url: v.ctx.panelUrl } : null);
const help = (ctx = {}) => {
    const s = ctx.support || {};
    const bits = [s.email && `write to ${s.email}`, s.phone && `call ${s.phone}`].filter(Boolean);
    return bits.length ? `Need help? Please ${bits.join(' or ')}.` : '';
};

/* ------------------------------ billing (from the platform to the shop owner) ------------------------------ */
function rentInvoice(v) {
    const i = inv(v);
    const month = i.period ? monthLabel(i.period) : null;
    return compose({
        ctx: v.ctx,
        subject: `Your bill ${i.invoiceNo}${month ? ` for ${month}` : ''}`,
        preheader: `${rs(i.total)} to pay${i.graceEndsAt ? ` by ${day(i.graceEndsAt)}` : ''}`,
        heading: 'Your new bill is ready',
        paragraphs: [
            `Hello ${shop(v)}, your bill is ready. The invoice is attached as a PDF.`,
            i.seller?.paymentInstructions ? `How to pay: ${i.seller.paymentInstructions}` : '',
        ],
        rows: [
            ['Invoice no', i.invoiceNo], ['Billing month', month], ['Billable orders', i.orderCount], ['Plan', i.tierLabel],
            ['Amount to pay', rs(i.total)], ['Due date', day(i.dueDate)], ['Keep taking orders until', day(i.graceEndsAt)],
        ],
        button: panelButton(v, 'Open billing'),
        note: help(v.ctx),
    });
}

function paymentReceipt(v) {
    const i = inv(v);
    return compose({
        ctx: v.ctx,
        subject: `Payment received for invoice ${i.invoiceNo}`,
        preheader: `Thank you. ${rs(i.total)} received.`,
        heading: 'Payment received',
        paragraphs: [`Thank you, ${shop(v)}. We received your payment.`],
        rows: [
            ['Invoice no', i.invoiceNo], ['Amount paid', rs(i.total)], ['Paid on', day(i.paidAt)],
            ['Payment mode', i.paymentMode ? String(i.paymentMode).replace('_', ' ') : null], ['Reference', i.paymentRef],
        ],
        button: panelButton(v, 'Open billing'),
        note: help(v.ctx),
    });
}

function billReminder(v) {
    const i = inv(v);
    return compose({
        ctx: v.ctx,
        subject: `Reminder: bill ${i.invoiceNo} is unpaid`,
        preheader: `New orders will stop after ${day(i.graceEndsAt)}`,
        heading: 'Your bill is still unpaid',
        paragraphs: [`Hello ${shop(v)}, bill ${i.invoiceNo} (${rs(i.total)}) is still unpaid.`, `New orders will stop after ${day(i.graceEndsAt)} if it is not paid.`],
        rows: [['Invoice no', i.invoiceNo], ['Amount to pay', rs(i.total)], ['Pay before', day(i.graceEndsAt)]],
        button: panelButton(v, 'Pay now'),
        note: help(v.ctx),
    });
}

function shopPaused(v) {
    const i = inv(v);
    return compose({
        ctx: v.ctx,
        subject: 'Your shop is paused',
        preheader: 'New orders are stopped until the bill is paid',
        heading: 'Your shop is paused',
        paragraphs: [
            `${shop(v)} is paused, so new orders are stopped. ${v.reason || (i.invoiceNo ? `Invoice ${i.invoiceNo} (${rs(i.total)}) is unpaid.` : 'A bill is unpaid.')}`,
            'Orders already in progress can still be finished. Pay the bill and your shop opens again.',
        ],
        rows: [['Invoice no', i.invoiceNo], ['Amount to pay', i.invoiceNo ? rs(i.total) : null]],
        button: panelButton(v, 'Pay now'),
        note: help(v.ctx),
    });
}

function shopUnpaused(v) {
    return compose({
        ctx: v.ctx,
        subject: 'Your shop is open again',
        preheader: 'You can take new orders again',
        heading: 'Your shop is open again',
        paragraphs: [`Good news, ${shop(v)} can take new orders again.`, v.reason || ''],
        button: panelButton(v, 'Open the app panel'),
        note: help(v.ctx),
    });
}

function freeEnding(v) {
    return compose({
        ctx: v.ctx,
        subject: 'Your free service is ending soon',
        preheader: v.summary || 'A monthly rent applies after the free period',
        heading: 'Your free service is ending soon',
        paragraphs: [`Hello ${shop(v)}, ${v.summary || 'your free period is almost over'}.`, 'After that a monthly rent applies. Your first bill will come after the month ends.'],
        button: panelButton(v, 'See billing'),
        note: help(v.ctx),
    });
}

function smsTopupReceipt(v) {
    return compose({
        ctx: v.ctx,
        subject: 'SMS balance added',
        preheader: `${rs((v.amountPaise || 0) / 100)} added to your SMS balance`,
        heading: 'SMS balance added',
        paragraphs: [`Thank you, ${shop(v)}. Your SMS top-up is done.`],
        rows: [['Amount added', rs((v.amountPaise || 0) / 100)], ['New balance', rs((v.balanceAfter || 0) / 100)], ['Date', dateTime(v.paidAt || new Date())]],
        button: panelButton(v, 'Open SMS balance'),
        note: help(v.ctx),
    });
}

function invoiceVoid(v) {
    const i = inv(v);
    const action = v.action === 'waived' ? 'waived' : 'voided';
    return compose({
        ctx: v.ctx,
        subject: `Invoice ${i.invoiceNo} was ${action}`,
        preheader: 'You do not need to pay this bill',
        heading: `Your bill was ${action}`,
        paragraphs: [`Invoice ${i.invoiceNo} (${rs(i.total)}) was ${action}. You do not need to pay it.`, v.reason ? `Reason: ${v.reason}` : ''],
        rows: [['Invoice no', i.invoiceNo], ['Amount', rs(i.total)]],
        note: help(v.ctx),
    });
}

/* ------------------------------ account ------------------------------ */
function welcome(v) {
    return compose({
        ctx: v.ctx,
        subject: `Welcome to ${v.ctx?.brand?.name || 'the app'}`,
        preheader: `Your account for ${shop(v)} is ready`,
        heading: `Welcome${v.name ? `, ${v.name}` : ''}!`,
        paragraphs: [
            `Your account for ${shop(v)} is ready.`,
            v.phoneMasked ? `Log in to the app with your mobile number ${v.phoneMasked}. We send you a one time code by SMS.` : 'Log in to the app with your mobile number. We send you a one time code by SMS.',
        ],
        button: panelButton(v, 'Open the app panel'),
        note: help(v.ctx),
    });
}

function ownerEmailChanged(v) {
    return compose({
        ctx: v.ctx,
        subject: 'The email of your account was changed',
        preheader: 'Please check that this was you',
        heading: 'Your account email was changed',
        paragraphs: [
            `The email address of your ${shop(v)} account was changed${v.newEmailMasked ? ` to ${v.newEmailMasked}` : ''}${v.when ? ` on ${dateTime(v.when)}` : ''}.`,
            'If this was not you, please contact support at once.',
        ],
        note: help(v.ctx),
    });
}

function loginAlert(v) {
    return compose({
        ctx: v.ctx,
        subject: 'New login to your account',
        preheader: 'Was this you?',
        heading: 'New login to your account',
        paragraphs: [`Your account${v.who ? ` (${v.who})` : ''} was just used to log in.`, 'If this was you, no action is needed. If it was not you, contact support at once.'],
        rows: [['When', dateTime(v.when)], ['Device', v.device], ['IP address', v.ip]],
        note: help(v.ctx),
    });
}

function policyChange(v) {
    const label = v.kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
    return compose({
        ctx: v.ctx,
        subject: `We updated our ${label}`,
        preheader: v.summary || `Please read the new ${label}`,
        heading: `We updated our ${label}`,
        paragraphs: [v.summary || `We made changes to our ${label}.`, 'By using the app after this date you accept the new version.'],
        rows: [['Applies from', day(v.effectiveDate)]],
        button: v.url ? { label: `Read the ${label}`, url: v.url } : null,
        note: help(v.ctx),
    });
}

/* ------------------------------ customers (only if the customer has an email) ------------------------------ */
function refundDecision(v) {
    const words = {
        started: 'We started your refund. It reaches your account in a few days.',
        done: 'Your refund is done. It reaches your account in a few days.',
        failed: 'We could not complete your refund yet. We will try again and tell you.',
    };
    return compose({
        ctx: v.ctx,
        subject: `Update on your refund for order #${v.orderNo}`,
        preheader: words[v.status] || 'An update on your refund',
        heading: 'About your refund',
        paragraphs: [words[v.status] || 'Here is an update on your refund.', v.reason ? `Reason: ${v.reason}` : ''],
        rows: [['Order', `#${v.orderNo}`], ['Refund amount', rs((v.amountPaise || 0) / 100)]],
        note: help(v.ctx),
    });
}

const RESOLUTION = { refund_full: 'Full refund', refund_partial: 'Partial refund', no_refund: 'No refund', none: 'No refund needed' };

function complaintDecision(v) {
    return compose({
        ctx: v.ctx,
        subject: `Update on your complaint for order #${v.orderNo}`,
        preheader: RESOLUTION[v.resolution] || 'The shop answered your complaint',
        heading: 'The shop answered your complaint',
        paragraphs: [v.ownerReply ? `"${v.ownerReply}"` : 'The shop looked at your complaint.'],
        rows: [
            ['Order', `#${v.orderNo}`], ['Decision', RESOLUTION[v.resolution] || 'Reviewed'],
            ['Refund amount', v.refundPaise > 0 ? rs(v.refundPaise / 100) : null],
        ],
        note: help(v.ctx),
    });
}

/* ------------------------------ broadcast ------------------------------ */
function broadcast(v) {
    return compose({
        ctx: v.ctx,
        subject: v.title || 'A message for you',
        preheader: String(v.body || '').slice(0, 90),
        heading: v.title || 'A message for you',
        paragraphs: String(v.body || '').split(/\n{2,}/),
        note: v.sender ? `Sent by ${v.sender}.` : '',
        promo: v.kind === 'promo',
    });
}

module.exports = {
    rentInvoice, paymentReceipt, billReminder, shopPaused, shopUnpaused, freeEnding, smsTopupReceipt, invoiceVoid,
    welcome, ownerEmailChanged, loginAlert, policyChange, refundDecision, complaintDecision, broadcast,
};