// The owner's Billing tab.   GET /api/shop/billing/status
// Mounted with .allowBlocked, so it stays open while the shop is paused for unpaid rent.
// Rent invoices themselves: GET /api/shop/subscription/invoices

const express = require('express');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const { resolveFee, freeStatus } = require('../utils/billingRules');
const { periodOf, nextPeriod, firstBillablePeriod } = require('../services/subscriptionService');
const { wrap } = require('../middlewares/apiErrors');
const prompts = require('../services/billingPromptService');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const monthStart = (p) => new Date(`${p}-01T00:00:00+05:30`);

router.get('/status', wrap(async (req, res) => {
    const now = new Date();
    const [t, platform] = await Promise.all([
        Tenant.findById(req.tenant._id).select('createdAt billing').lean(),
        PlatformSettings.findById('main').lean(),
    ]);
    const free = freeStatus(t, platform, now);
    const period = periodOf(now);
    const orders = await Order.countDocuments({
        tenantId: t._id, status: 'delivered',
        deliveredAt: { $gte: monthStart(period), $lt: monthStart(nextPeriod(period)) },
    });
    const tier = resolveFee(t, platform, orders);

    const [owed] = await SubscriptionInvoice.aggregate([
        { $match: { tenantId: t._id, status: 'pending' } },
        { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 }, graceEndsAt: { $min: '$graceEndsAt' } } },
    ]);
    const graceEndsAt = owed?.graceEndsAt || null;

    // the bill for the current month is made on the 1st of next month, unless this month was free or partly free
    const freeEndedAt = t.billing?.freeEndedAt;
    const billed = !free.free && freeEndedAt && period >= firstBillablePeriod(freeEndedAt);

    res.json({
        state: t.billing?.state || (free.free ? 'free' : 'active'),
        paused: t.billing?.state === 'paused',
        graceEndsAt,
        graceDaysLeft: graceEndsAt ? Math.max(0, Math.ceil((new Date(graceEndsAt) - now) / DAY_MS)) : null,
        due: { amount: owed?.amount || 0, count: owed?.count || 0 },
        free: { active: free.free, ordersLeft: free.ordersLeft, freeOrders: free.freeOrders, endsAt: free.endsAt },
        thisMonth: { period, deliveredOrders: orders, tierLabel: tier.label, fee: tier.fee },
        nextBill: billed
            ? { forPeriod: period, deliveredOrders: orders, fee: tier.fee, tierLabel: tier.label, billedOn: monthStart(nextPeriod(period)), note: 'GST is added if it applies' }
            : null,
    });
}));

// Warnings the app must show as a pop-up: unpaid bill, low SMS balance.
// Each item has show (true = open the pop-up now), canSnooze, severity, title, message and payScreen.
router.get('/prompts', wrap(async (req, res) => {
    res.json({ items: await prompts.list(req.tenant._id) });
}));

// Body: { "kind": "bill" | "sms", "choice": "pay_now" | "remind_later" }
router.post('/prompts/choice', wrap(async (req, res) => {
    if (req.actor?.type === 'superadmin') throw httpError(403, 'Only the shop owner can answer this reminder');
    res.json(await prompts.choose({
        tenantId: req.tenant._id,
        kind: req.body?.kind,
        choice: req.body?.choice,
        actor: req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || 'shop owner' },
    }));
}));

module.exports = router;