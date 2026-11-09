// One builder per mail. Each takes its data plus ctx (brand, footer, ...) and returns { subject, html, text }.
// Change the words of a mail HERE.
const { compose, rs, day, dateTime, monthLabel } = require('./layout');

const shop = (v) => v.shopName || 'your shop';
const panelButton = (v, label) => (v.ctx?.panelUrl ? { label, url: v.ctx.panelUrl } : null);
const help = (ctx = {}) => {
    const s = ctx.support || {};
    const bits = [s.email && `write to ${s.email}`, s.phone && `call ${s.phone}`].filter(Boolean);
    return bits.length ? `Need help? Please ${bits.join(' or ')}.` : '';
};

/* ------------------------------ billing (from the platform to the shop owner) ------------------------------ */
function smsTopupReceipt(v) {
    return compose({
        ctx: v.ctx,
        subject: 'SMS balance added',
        preheader: `${rs((v.amountPaise || 0) / 100)} added to your SMS balance`,
        heading: 'SMS balance added',
        paragraphs: [`Thank you, ${shop(v)}. Your SMS top-up is done.`],
        rows: [['Amount added to your balance', rs((v.amountPaise || 0) / 100)], ...(v.gstPaise ? [[`GST (${v.gstPercent}%)`, rs(v.gstPaise / 100)], ['Total paid', rs((v.payablePaise || 0) / 100)]] : []), ['New balance', rs((v.balanceAfter || 0) / 100)], ['Date', dateTime(v.paidAt || new Date())]],
        button: panelButton(v, 'Open SMS balance'),
        note: help(v.ctx),
    });
}

/* ------------------------------ the monthly progress report ------------------------------ */
function monthlyReport(v) {
    const r = v.report;
    const t = r?.totals || {};
    const amount = (n) => rs(n || 0).replace('.00', '');
    const up = (c) => (c === null || c === undefined ? null : `${c >= 0 ? '+' : ''}${c}% compared with the month before`);
    const best = r?.delivery?.best;
    const tips = (r?.tips || []).slice(0, 3).map((x) => `• ${x.title}. ${x.detail}`);
    return compose({
        ctx: v.ctx,
        subject: `Your ${r?.range?.label || 'monthly'} report: ${amount(t.revenue)} from ${t.orders || 0} orders`,
        preheader: `${amount(t.revenue)} in sales. See how ${shop(v)} did.`,
        heading: `How ${shop(v)} did in ${r?.range?.label || 'the last month'}`,
        paragraphs: [
            `Hello ${shop(v)}, here is your monthly report. The full report is attached as a PDF.`,
            `You made ${amount(t.revenue)} from ${t.orders || 0} delivered orders.${r?.milestones?.length ? ` ${r.milestones[0]}.` : ''}`,
            tips.length ? `What we suggest:\n${tips.join('\n')}` : '',
        ],
        rows: [
            ['Sales', amount(t.revenue)], ['Compared with the month before', up(r?.change?.revenue)], ['Delivered orders', t.orders],
            ['Average order', amount(t.avgOrder)], ['Customers', r?.customers?.unique], ['New customers', r?.customers?.newCount],
            ['Customers who came back', r?.customers?.unique ? `${r.customers.repeatPct}%` : null],
            ['Best seller', r?.food?.top?.[0] ? `${r.food.top[0].name} (${r.food.top[0].quantity})` : null],
            ['Best rated dish', r?.food?.loved?.[0] ? `${r.food.loved[0].name} (${r.food.loved[0].avg} stars)` : null],
            ['Best delivery partner', best ? `${best.name} (${best.deliveries} deliveries)` : null],
            ['Orders cancelled', t.placed ? `${t.cancelled} of ${t.placed}` : null],
            ...(r?.value?.show ? [['Sales through the app', amount(r.value.revenue)], ['Marketplace commission you avoided (estimate)', amount(r.value.marketplaceCost)], ['Paid for the app', amount(r.value.feeBilled)]] : []),
        ],
        button: panelButton(v, 'Open the full report'),
        note: [r?.quote, help(v.ctx)].filter(Boolean).join('\n\n'),
    });
}

/* ------------------------------ account ------------------------------ */
function emailCode(v) {
    return compose({
        ctx: v.ctx,
        subject: `Your verification code: ${v.code}`,
        preheader: `${v.code} is your code. It works for ${v.minutes || 10} minutes.`,
        heading: 'Confirm your email address',
        paragraphs: [
            `Hello${v.ownerName ? ` ${v.ownerName}` : ''}, enter this code in the app to confirm that this address is yours. Your bills and official documents will be sent here.`,
            `Your code is ${v.code}. It works for ${v.minutes || 10} minutes.`,
            'If you did not ask for this, you can ignore this email. Nobody can use your account without the code.',
        ],
        rows: [['Verification code', v.code]],
        note: help(v.ctx),
    });
}

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

module.exports = { monthlyReport, emailCode,
    smsTopupReceipt,
    welcome, ownerEmailChanged, loginAlert, policyChange, refundDecision, complaintDecision, broadcast,
};