// Sends the automatic billing messages to the owner. Runs every 10 minutes.
//   new bill issued          -> once per invoice
//   2 days before grace ends -> once per grace date (a longer grace gives a new reminder)
//   shop paused              -> once per grace date
//   payment received         -> once per invoice
//   free period nearly over  -> at most every 3 days
//   SMS balance low / zero   -> at most every 24 hours, until he pays
// Every "once" is a filtered atomic update, so it is safe if two servers run it.
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const SmsWallet = require('../models/SmsWallet');
const Notification = require('../models/Notification');
const wallet = require('./smsWalletService');
const notify = require('./notificationService');
const { freeStatus } = require('../utils/billingRules');

const DAY_MS = 86400000;
const RECENT_MS = 3 * DAY_MS;          // do not announce old bills or old payments
const REMIND_BEFORE_MS = 2 * DAY_MS;

const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
const rs = (n) => `Rs ${Math.round(n * 100) / 100}`;
const rsPaise = (p) => `Rs ${(p / 100).toFixed(2)}`;

const recentlySent = (tenantId, type, ms, now) => Notification.exists({
    tenantId, role: 'owner', type, createdAt: { $gte: new Date(now.getTime() - ms) },
});

async function billIssued(now) {
    const list = await SubscriptionInvoice.find({
        status: 'pending', notifiedAt: null, issueDate: { $gte: new Date(now.getTime() - RECENT_MS) },
    }).select('tenantId invoiceNo total graceEndsAt dueDate').limit(100).lean();

    for (const inv of list) {
        const claimed = await SubscriptionInvoice.updateOne({ _id: inv._id, status: 'pending', notifiedAt: null }, { $set: { notifiedAt: now } });
        if (!claimed.modifiedCount) continue;
        notify.toOwner(inv.tenantId, {
            type: 'bill_issued', title: 'New bill',
            body: `Invoice ${inv.invoiceNo}: ${rs(inv.total)}. Please pay by ${day(inv.graceEndsAt || inv.dueDate)} to keep taking orders.`,
            data: { invoiceId: String(inv._id), prompt: 'bill' },
        });
    }
}

async function graceReminders(now) {
    const list = await SubscriptionInvoice.find({
        status: 'pending',
        graceEndsAt: { $gt: now, $lte: new Date(now.getTime() + REMIND_BEFORE_MS) },
        $expr: { $ne: ['$reminderForGraceAt', '$graceEndsAt'] },
    }).select('tenantId invoiceNo total graceEndsAt').limit(100).lean();

    for (const inv of list) {
        const claimed = await SubscriptionInvoice.updateOne(
            { _id: inv._id, status: 'pending', graceEndsAt: inv.graceEndsAt, reminderForGraceAt: { $ne: inv.graceEndsAt } },
            { $set: { reminderForGraceAt: inv.graceEndsAt } },
        );
        if (!claimed.modifiedCount) continue;
        notify.toOwner(inv.tenantId, {
            type: 'bill_reminder', title: 'Bill reminder',
            body: `Invoice ${inv.invoiceNo} (${rs(inv.total)}) is still unpaid. New orders will stop after ${day(inv.graceEndsAt)}.`,
            data: { invoiceId: String(inv._id), prompt: 'bill' },
        });
    }
}

async function pausedNotices(now) {
    const list = await SubscriptionInvoice.find({
        status: 'pending',
        graceEndsAt: { $type: 'date', $lte: now },
        $expr: { $ne: ['$pausedNoticeFor', '$graceEndsAt'] },
    }).select('tenantId invoiceNo total graceEndsAt').limit(100).lean();

    for (const inv of list) {
        const claimed = await SubscriptionInvoice.updateOne(
            { _id: inv._id, status: 'pending', graceEndsAt: inv.graceEndsAt, pausedNoticeFor: { $ne: inv.graceEndsAt } },
            { $set: { pausedNoticeFor: inv.graceEndsAt } },
        );
        if (!claimed.modifiedCount) continue;
        notify.toOwner(inv.tenantId, {
            type: 'shop_paused', title: 'Your shop is paused',
            body: `Invoice ${inv.invoiceNo} (${rs(inv.total)}) is unpaid, so new orders are stopped. Pay now to start again.`,
            data: { invoiceId: String(inv._id), prompt: 'bill' },
        });
    }
}

async function paymentsReceived(now) {
    const list = await SubscriptionInvoice.find({
        status: 'paid', paidAt: { $gte: new Date(now.getTime() - RECENT_MS) }, paidNotifiedAt: null,
    }).select('tenantId invoiceNo total').limit(100).lean();

    for (const inv of list) {
        const claimed = await SubscriptionInvoice.updateOne({ _id: inv._id, status: 'paid', paidNotifiedAt: null }, { $set: { paidNotifiedAt: now } });
        if (!claimed.modifiedCount) continue;
        notify.toOwner(inv.tenantId, {
            type: 'payment_received', title: 'Payment received',
            body: `Thank you. Invoice ${inv.invoiceNo} (${rs(inv.total)}) is paid.`,
            data: { invoiceId: String(inv._id) },
        });
    }
}

async function freeEnding(now) {
    const platform = await PlatformSettings.findById('main').lean();
    const shops = await Tenant.find({ 'billing.state': 'free' }).select('createdAt billing').lean();
    for (const t of shops) {
        const f = freeStatus(t, platform, now);
        if (!f.free) continue;
        const daysLeft = f.endsAt ? (new Date(f.endsAt).getTime() - now.getTime()) / DAY_MS : null;
        const ordersNear = Number.isFinite(f.ordersLeft) && f.ordersLeft <= 10;
        const timeNear = daysLeft !== null && daysLeft <= 7;
        if (!ordersNear && !timeNear) continue;
        if (await recentlySent(t._id, 'free_ending', 3 * DAY_MS, now)) continue;

        const parts = [];
        if (ordersNear) parts.push(`${f.ordersLeft} free order(s) left`);
        if (timeNear) parts.push(`${Math.max(1, Math.ceil(daysLeft))} day(s) left`);
        notify.toOwner(t._id, {
            type: 'free_ending', title: 'Free service is ending soon',
            body: `${parts.join(' and ')}. After that a monthly rent applies.`,
        });
    }
}

async function smsBalances(now) {
    if (!wallet.shouldCharge()) return;   // mock SMS does not use the wallet
    // only wallets under Rs 1000 can be low; the exact check is done by wallet.status()
    const rows = await SmsWallet.find({ balancePaise: { $lt: 100000 } }).select('tenantId').lean();
    for (const w of rows) {
        const s = await wallet.status(w.tenantId);
        const type = s.zero ? 'sms_zero' : s.low ? 'sms_low' : null;
        if (!type) continue;
        if (await recentlySent(w.tenantId, type, DAY_MS, now)) continue;
        notify.toOwner(w.tenantId, type === 'sms_zero'
            ? {
                type, title: 'SMS balance is finished', data: { prompt: 'sms' },
                body: s.blockAtZero ? 'Customers cannot log in until you top up.' : 'Please top up your SMS balance.',
            }
            : {
                type, title: 'SMS balance is low', data: { prompt: 'sms' },
                body: `Your balance is ${rsPaise(s.balancePaise)}. Top up so customers can keep logging in.`,
            });
    }
}

async function runAlerts(now = new Date()) {
    for (const step of [billIssued, graceReminders, pausedNotices, paymentsReceived, freeEnding, smsBalances]) {
        try {
            await step(now);
        } catch (e) {
            console.error(`Billing alerts (${step.name}) error:`, e.message);
        }
    }
}

function startBillingAlertsScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await runAlerts(); } finally { running = false; }
    };
    setTimeout(run, 45 * 1000).unref?.();
    setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { runAlerts, startBillingAlertsScheduler };