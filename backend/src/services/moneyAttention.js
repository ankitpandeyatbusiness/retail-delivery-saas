// The Money tab's "Needs attention": everything about money that wants a decision or a look today, each with how many, how much, and where to fix it.
// Two kinds: things owed or lost (overdue bills, shops to close, failed refunds, low SMS wallets) and things that do not add up
// (a Razorpay event that failed, money that reached the platform for a bill nobody knows, a paid top-up whose wallet was not credited).
// Read-only: it only counts and lists.
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const OnlineRefund = require('../models/OnlineRefund');
const SmsWallet = require('../models/SmsWallet');
const SmsTopup = require('../models/SmsTopup');
const SmsTransaction = require('../models/SmsTransaction');
const Notification = require('../models/Notification');
const Tenant = require('../models/Tenant');

const DAY = 86400000;
const LOW_DEFAULT = 5000;   // paise, the same default as services/smsWalletService.js

async function attention({ now = Date.now() } = {}) {
    const n = new Date(now);
    const since = new Date(now - 14 * DAY);
    const items = [];
    const add = (it) => { if (it.count > 0) items.push(it); };

    const [overdue, failedHooks, stuckHooks, refunds, lowWallets, unmatched, paidTopups, paidNoDate] = await Promise.all([
        SubscriptionInvoice.aggregate([{ $match: { status: 'pending', dueDate: { $lt: n } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' }, shops: { $addToSet: '$tenantId' } } }]),
        PaymentWebhookEvent.find({ account: 'platform', status: 'failed', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(5).select('event error createdAt').lean(),
        PaymentWebhookEvent.countDocuments({ account: 'platform', status: 'processing', updatedAt: { $lt: new Date(now - 15 * 60000) }, createdAt: { $gte: since } }),
        OnlineRefund.aggregate([{ $match: { status: 'failed' } }, { $group: { _id: null, count: { $sum: 1 }, paise: { $sum: '$amountPaise' } } }]),
        SmsWallet.countDocuments({ $expr: { $lte: ['$balancePaise', { $ifNull: ['$lowBalancePaise', LOW_DEFAULT] }] } }),
        Notification.find({ role: 'superadmin', type: 'admin_webhook_failed', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(5).select('title body createdAt').lean(),
        SmsTopup.find({ status: 'paid', paidAt: { $gte: since }, paymentId: { $type: 'string' } }).select('paymentId tenantId ref').lean(),
        SubscriptionInvoice.countDocuments({ status: 'paid', paidAt: { $exists: false } }),
    ]);

    const o = overdue[0];
    add({ key: 'overdue', level: 'bad', title: 'Overdue rent bills', hint: o ? `${o.shops.length} shop${o.shops.length === 1 ? '' : 's'} have not paid after the due date.` : '', count: o?.count || 0, paise: Math.round((o?.total || 0) * 100), screen: 'Invoices', params: { status: 'overdue' } });

    let toClose = 0;
    try { toClose = ((await require('./shopClosure').toClose(n)).shops || []).length; } catch (e) { toClose = 0; }
    add({ key: 'to_close', level: 'warn', title: 'Shops to close', hint: 'Rent unpaid for months. They close only when you tap.', count: toClose, screen: 'ShopsToClose' });

    const f = refunds[0];
    add({ key: 'refunds_failed', level: 'bad', title: 'Refunds that failed', hint: 'The customer has not got the money back. Send again from Refunds.', count: f?.count || 0, paise: f?.paise || 0, screen: 'Refunds' });

    add({ key: 'webhook_failed', level: 'bad', title: 'Razorpay events that failed', hint: failedHooks[0]?.error ? `Last: ${String(failedHooks[0].error).slice(0, 90)}` : 'Money may have arrived that the app did not record.', count: failedHooks.length + stuckHooks, screen: 'MyRazorpay' });

    add({ key: 'unmatched', level: 'bad', title: 'Money received for no bill', hint: unmatched[0]?.body ? String(unmatched[0].body).slice(0, 110) : 'A payment reached your Razorpay that no bill or top-up knows.', count: unmatched.length, screen: 'MyRazorpay' });

    // a top-up marked paid whose wallet was never credited (the credit row is keyed by the same Razorpay payment id)
    let uncredited = 0;
    if (paidTopups.length) {
        const have = new Set((await SmsTransaction.find({ type: 'topup', paymentId: { $in: paidTopups.map((t) => t.paymentId) } }).select('paymentId').lean()).map((x) => x.paymentId));
        uncredited = paidTopups.filter((t) => !have.has(t.paymentId)).length;
    }
    add({ key: 'topup_uncredited', level: 'bad', title: 'SMS top-ups paid but not credited', hint: 'The shop paid and its wallet did not grow. Check Transactions.', count: uncredited, screen: 'Ledger' });

    add({ key: 'paid_no_date', level: 'warn', title: 'Bills marked paid without a date', hint: 'They will be missing from the monthly numbers and the GST register.', count: paidNoDate, screen: 'Invoices', params: { status: 'paid' } });

    add({ key: 'sms_low', level: 'warn', title: 'SMS wallets running low', hint: 'Those shops stop sending messages when the wallet is empty.', count: lowWallets, screen: 'SmsProfit' });

    try {
        const sb = await require('./smsProviderBalance').current(now);
        if (sb.level === 'low' || sb.level === 'empty') {
            add({ key: 'sms_provider', level: sb.level === 'empty' ? 'bad' : 'warn', title: sb.level === 'empty' ? 'SMS balance almost empty' : 'SMS balance is low', hint: `About ₹${Math.round(sb.paise / 100).toLocaleString('en-IN')} left at your SMS provider${sb.source === 'estimate' ? ' (an estimate)' : ''}.`, count: 1, screen: 'SmsBalance' });
        }
    } catch (e) { /* the rest of the list still shows */ }

    const rank = { bad: 0, warn: 1 };
    items.sort((a, b) => (rank[a.level] - rank[b.level]));
    return { items, counts: { total: items.length, bad: items.filter((i) => i.level === 'bad').length }, checkedAt: n };
}

module.exports = { attention, LOW_DEFAULT };
