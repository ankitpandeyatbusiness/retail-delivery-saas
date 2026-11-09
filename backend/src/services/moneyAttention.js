// The Money tab's "Needs attention": everything about money that wants a decision or a look today, each with how many, how much, and where to fix it.
// Two kinds: things owed or lost (failed refunds, low SMS wallets) and things that do not add up
// (a Razorpay event that failed, money that reached the platform for a payment nobody knows, a paid top-up whose wallet was not credited).
// An item the superadmin marked "handled by hand" (services/handledMarks.js) leaves the count; the thing itself is never changed.
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const OnlineRefund = require('../models/OnlineRefund');
const SmsWallet = require('../models/SmsWallet');
const SmsTopup = require('../models/SmsTopup');
const SmsTransaction = require('../models/SmsTransaction');
const Notification = require('../models/Notification');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const handled = require('./handledMarks');

const DAY = 86400000;
const LOW_DEFAULT = 5000;   // paise, the same default as services/smsWalletService.js
const rs = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// ids marked handled, per list: as strings and as ObjectIds for queries
async function marks() {
    const out = {};
    for (const k of handled.MONEY) { const ids = await handled.activeIds(k); out[k] = { ids, oids: handled.objectIds(ids) }; }
    return out;
}
const notIn = (m) => (m.oids.length ? { _id: { $nin: m.oids } } : {});

async function attention({ now = Date.now() } = {}) {
    const n = new Date(now);
    const since = new Date(now - 14 * DAY);
    const items = [];
    const add = (it) => { if (it.count > 0) items.push(it); };
    const h = await marks();

    const [failedHooks, stuckHooks, refunds, lowWallets, unmatched, paidTopups] = await Promise.all([
        PaymentWebhookEvent.find({ account: 'platform', status: 'failed', createdAt: { $gte: since }, ...notIn(h.webhook_failed) }).sort({ createdAt: -1 }).limit(5).select('event error createdAt').lean(),
        PaymentWebhookEvent.countDocuments({ account: 'platform', status: 'processing', updatedAt: { $lt: new Date(now - 15 * 60000) }, createdAt: { $gte: since }, ...notIn(h.webhook_failed) }),
        OnlineRefund.aggregate([{ $match: { status: 'failed', ...notIn(h.refund_failed) } }, { $group: { _id: null, count: { $sum: 1 }, paise: { $sum: '$amountPaise' } } }]),
        SmsWallet.countDocuments({ $expr: { $lte: ['$balancePaise', { $ifNull: ['$lowBalancePaise', LOW_DEFAULT] }] }, ...notIn(h.sms_low) }),
        Notification.find({ role: 'superadmin', type: 'admin_webhook_failed', createdAt: { $gte: since }, ...notIn(h.unmatched) }).sort({ createdAt: -1 }).limit(5).select('title body createdAt').lean(),
        SmsTopup.find({ status: 'paid', paidAt: { $gte: since }, paymentId: { $type: 'string' }, ...notIn(h.topup_uncredited) }).select('paymentId tenantId ref').lean(),
    ]);

    const f = refunds[0];
    add({ key: 'refunds_failed', level: 'bad', title: 'Refunds that failed', hint: 'The customer has not got the money back. Open to see why, send again or mark it handled.', count: f?.count || 0, paise: f?.paise || 0, screen: 'Refunds' });

    add({ key: 'webhook_failed', level: 'bad', title: 'Razorpay events that failed', hint: failedHooks[0]?.error ? `Last: ${String(failedHooks[0].error).slice(0, 90)}` : 'Money may have arrived that the app did not record.', count: failedHooks.length + stuckHooks, screen: 'MyRazorpay' });

    add({ key: 'unmatched', level: 'bad', title: 'Money received for no bill', hint: unmatched[0]?.body ? String(unmatched[0].body).slice(0, 110) : 'A payment reached your Razorpay that no bill or top-up knows.', count: unmatched.length, screen: 'MyRazorpay' });

    // a top-up marked paid whose wallet was never credited (the credit row is keyed by the same Razorpay payment id)
    let uncredited = 0;
    if (paidTopups.length) {
        const have = new Set((await SmsTransaction.find({ type: 'topup', paymentId: { $in: paidTopups.map((t) => t.paymentId) } }).select('paymentId').lean()).map((x) => x.paymentId));
        uncredited = paidTopups.filter((t) => !have.has(t.paymentId)).length;
    }
    add({ key: 'topup_uncredited', level: 'bad', title: 'SMS top-ups paid but not credited', hint: 'The shop paid and its wallet did not grow. Open to see which.', count: uncredited, screen: 'Ledger' });

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

// ---------- one list opened: every record with the reason, so it can be opened, sorted out by hand or marked handled ----------
const KIND_OF = { refunds_failed: 'refund_failed', webhook_failed: 'webhook_failed', unmatched: 'unmatched', topup_uncredited: 'topup_uncredited', sms_low: 'sms_low' };
const shopNames = async (ids) => new Map((await Tenant.find({ _id: { $in: [...new Set(ids.map(String))] } }).select('name').lean()).map((s) => [String(s._id), s.name]));
const days = (from, now) => Math.max(0, Math.floor((now - new Date(from).getTime()) / DAY));

// every candidate row of one list (newest first, at most 100), without looking at the marks
async function candidates(key, now) {
    const n = new Date(now);
    const since = new Date(now - 14 * DAY);
    if (key === 'refunds_failed') {
        const rows = await OnlineRefund.find({ status: 'failed' }).sort({ createdAt: -1 }).limit(100).lean();
        const orders = new Map((await Order.find({ _id: { $in: rows.map((r) => r.orderId) } }).select('orderNo ref customer').lean()).map((x) => [String(x._id), x]));
        const names = await shopNames(rows.map((r) => r.tenantId));
        return rows.map((r) => {
            const od = orders.get(String(r.orderId));
            return { id: String(r._id), title: `${names.get(String(r.tenantId)) || 'Shop'} · order ${od?.ref || '#' + (od?.orderNo || '')}`, detail: r.lastError ? `Why: ${r.lastError}` : 'Razorpay did not accept the refund', paise: r.amountPaise, at: r.createdAt, open: { screen: 'Refunds' }, retry: { refundId: String(r._id) } };
        });
    }
    if (key === 'webhook_failed') {
        const rows = await PaymentWebhookEvent.find({ account: 'platform', status: { $in: ['failed', 'processing'] }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(100).select('event error status createdAt updatedAt').lean();
        return rows.filter((r) => r.status === 'failed' || new Date(r.updatedAt).getTime() < now - 15 * 60000).map((r) => ({ id: String(r._id), title: `Razorpay event: ${r.event || 'unknown'}`, detail: r.error ? `Why: ${String(r.error).slice(0, 160)}` : 'It started and never finished', at: r.createdAt, open: { screen: 'MyRazorpay' } }));
    }
    if (key === 'unmatched') {
        const rows = await Notification.find({ role: 'superadmin', type: 'admin_webhook_failed', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(100).select('title body createdAt').lean();
        return rows.map((r) => ({ id: String(r._id), title: r.title || 'Money received for no bill', detail: String(r.body || '').slice(0, 200), at: r.createdAt, open: { screen: 'MyRazorpay' } }));
    }
    if (key === 'topup_uncredited') {
        const rows = await SmsTopup.find({ status: 'paid', paidAt: { $gte: since }, paymentId: { $type: 'string' } }).sort({ paidAt: -1 }).limit(100).select('paymentId tenantId ref amountPaise payablePaise paidAt').lean();
        const have = new Set((await SmsTransaction.find({ type: 'topup', paymentId: { $in: rows.map((t) => t.paymentId) } }).select('paymentId').lean()).map((x) => x.paymentId));
        const names = await shopNames(rows.map((r) => r.tenantId));
        return rows.filter((t) => !have.has(t.paymentId)).map((r) => ({ id: String(r._id), title: `${names.get(String(r.tenantId)) || 'Shop'} · top-up ${r.ref || ''}`.trim(), detail: `Paid, payment ${r.paymentId}. The wallet did not grow.`, paise: r.payablePaise || r.amountPaise, at: r.paidAt, open: { screen: 'Ledger' } }));
    }
    if (key === 'sms_low') {
        const rows = await SmsWallet.find({ $expr: { $lte: ['$balancePaise', { $ifNull: ['$lowBalancePaise', LOW_DEFAULT] }] } }).sort({ balancePaise: 1 }).limit(100).lean();
        const names = await shopNames(rows.map((r) => r.tenantId));
        return rows.map((r) => ({ id: String(r._id), title: names.get(String(r.tenantId)) || 'Shop', detail: `${rs((r.balancePaise || 0) / 100)} left, the low line is ${rs((r.lowBalancePaise ?? LOW_DEFAULT) / 100)}`, paise: r.balancePaise || 0, open: { screen: 'ShopSms', params: { shopId: String(r.tenantId), name: names.get(String(r.tenantId)) } } }));
    }
    return null;
}

// { open: [...], handled: [...] } for one list key of the attention list
async function records(key, { now = Date.now() } = {}) {
    const kind = KIND_OF[key];
    if (!kind) return null;
    const rows = await candidates(key, now);
    if (!rows) return null;
    const m = await handled.mapFor(kind, now);
    const open = [];
    const done = [];
    for (const r of rows) {
        const mk = m.get(r.id);
        if (mk) done.push({ ...r, mark: mk }); else open.push(r);
    }
    // marks whose record is no longer a candidate (it got fixed, or left the window) still show in Handled
    const seen = new Set(rows.map((r) => r.id));
    for (const [id, mk] of m) if (!seen.has(id)) done.push({ id, title: mk.title || 'Item', detail: 'No longer in the list', mark: mk });
    done.sort((a, b) => new Date(b.mark.at) - new Date(a.mark.at));
    return { key, kind, open, handled: done };
}

module.exports = { attention, records, LOW_DEFAULT, KIND_OF };
