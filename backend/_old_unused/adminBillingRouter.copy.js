// Superadmin: billing rules, shop overrides, custom invoices, void / waive, grace and unpause.
// Mounted inside adminRouter (after requireSuperAdmin).
//
//   PUT   /api/admin/platform/billing/tiers            body { "tiers": [{ "upTo": 305, "fee": 3000 }, { "upTo": 1005, "fee": 6000 }, { "upTo": null, "fee": 10000 }] }
//   PUT   /api/admin/tenants/:tid/billing              body: any of freeOrdersOverride, freeMonthsOverride, fixedFeeOverride,
//                                                      tiersOverride, goLiveAt (null = back to default), or { "reset": true } alone
//   GET   /api/admin/tenants/:tid/billing/preview      ?period=2026-10  what that month's bill would be
//   POST  /api/admin/tenants/:tid/billing/unpause      body { "days": 3 } (optional) gives a new grace window
//   POST  /api/admin/tenants/:tid/invoices/custom      body { lineItems:[{description, qty, rate}], gstPercent?, graceDays?, blocksShop?, dueDays?, note? }
//   PATCH /api/admin/subscriptions/invoices/:id/void   body { "reason": "..." }
//   PATCH /api/admin/subscriptions/invoices/:id/waive  body { "reason": "..." }
//   PATCH /api/admin/subscriptions/invoices/:id/extend-grace   body { "days": 5 }
// (Marking an invoice paid is the existing PATCH .../status route.)

const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const Counter = require('../models/Counter');
const { validateTiers, resolveFee, freeStatus } = require('../utils/billingRules');
const {
    periodOf, nextPeriod, financialYear, firstBillablePeriod, syncFreeState, PERIOD_RE, withOverdue,
} = require('../services/subscriptionService');
const { enforceTenant } = require('../services/billingEnforcement');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const loadTenant = require('../middlewares/loadTenant');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const cleanText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const monthStart = (p) => new Date(`${p}-01T00:00:00+05:30`);
const wholeDays = (v, min, max, name) => {
    if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${name} must be a whole number from ${min} to ${max}`);
    return v;
};

/* ------------------------------ platform tiers ------------------------------ */
router.put('/platform/billing/tiers', wrap(async (req, res) => {
    const v = validateTiers(req.body?.tiers);
    if (!v.ok) return res.status(400).json({ error: 'Invalid tiers', errors: v.errors });
    await PlatformSettings.findByIdAndUpdate(
        'main', { $set: { 'billing.tiers': v.clean } }, { upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ tiers: v.clean });   // only invoices made from now on use these; issued invoices never change
}));

/* ------------------------------ one shop: overrides ------------------------------ */
router.put('/tenants/:tid/billing', loadTenant, wrap(async (req, res) => {
    const body = req.body || {};
    const id = req.tenantDoc._id;
    req.auditBefore = { billing: (await Tenant.findById(id).select('billing').lean())?.billing };

    const set = {};
    const unset = {};
    if (body.reset === true) {
        if (Object.keys(body).length > 1) throw httpError(400, 'Send reset alone');
        ['freeOrdersOverride', 'freeMonthsOverride', 'fixedFeeOverride'].forEach((k) => { set[`billing.${k}`] = null; });
        unset['billing.tiersOverride'] = 1;
    } else {
        const whole = (key, max) => {
            if (body[key] === undefined) return;
            set[`billing.${key}`] = body[key] === null ? null : wholeDays(body[key], 0, max, key);
        };
        whole('freeOrdersOverride', 100000);
        whole('freeMonthsOverride', 36);

        if (body.fixedFeeOverride !== undefined) {
            const f = body.fixedFeeOverride;
            if (f !== null && (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 10000000)) {
                throw httpError(400, 'fixedFeeOverride must be a number (rupees) or null');
            }
            set['billing.fixedFeeOverride'] = f;
        }
        if (body.tiersOverride !== undefined) {
            if (body.tiersOverride === null) unset['billing.tiersOverride'] = 1;
            else {
                const v = validateTiers(body.tiersOverride);
                if (!v.ok) return res.status(400).json({ error: 'Invalid tiers', errors: v.errors });
                set['billing.tiersOverride'] = v.clean;
            }
        }
        if (body.goLiveAt !== undefined) {
            if (body.goLiveAt === null) unset['billing.goLiveAt'] = 1;
            else {
                const d = new Date(body.goLiveAt);
                if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid goLiveAt date');
                set['billing.goLiveAt'] = d;
            }
        }
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (!Object.keys(update).length) throw httpError(400, 'Nothing to change');
    await Tenant.updateOne({ _id: id }, update);

    // a changed limit or go-live date can reopen or end free service: update the state now
    const platform = await PlatformSettings.findById('main').lean();
    const fresh = await Tenant.findById(id).select('slug createdAt billing').lean();
    await syncFreeState(fresh, platform);
    invalidateTenant(fresh.slug);

    const after = await Tenant.findById(id).select('createdAt billing').lean();
    res.json({ billing: after.billing, free: freeStatus(after, platform) });
}));

/* ------------------------------ preview of a bill ------------------------------ */
router.get('/tenants/:tid/billing/preview', loadTenant, wrap(async (req, res) => {
    const now = new Date();
    const period = req.query.period === undefined ? periodOf(now) : String(req.query.period);
    if (!PERIOD_RE.test(period)) throw httpError(400, 'period must look like 2026-10');

    const [tenant, platform] = await Promise.all([
        Tenant.findById(req.tenantDoc._id).select('createdAt billing subscription').lean(),
        PlatformSettings.findById('main').lean(),
    ]);
    const orderCount = await Order.countDocuments({
        tenantId: tenant._id, status: 'delivered',
        deliveredAt: { $gte: monthStart(period), $lt: monthStart(nextPeriod(period)) },
    });
    const { fee, label } = resolveFee(tenant, platform, orderCount);
    const gstPercent = platform?.business?.gstin ? (tenant.subscription?.gstPercent ?? 18) : 0;
    const gstAmount = round2((fee * gstPercent) / 100);

    let reason = null;
    const freeEndedAt = tenant.billing?.freeEndedAt;
    if (freeStatus(tenant, platform, now).free) reason = 'The shop is still in free service';
    else if (!freeEndedAt) reason = 'Free service has just ended. The state updates within 5 minutes';
    else if (period < firstBillablePeriod(freeEndedAt)) reason = 'This month was free or partly free, so it is not billed';
    else if (await SubscriptionInvoice.exists({ tenantId: tenant._id, period, kind: 'monthly' })) reason = 'This month is already invoiced';

    res.json({
        period, orderCount, tierLabel: label, fee, gstPercent, gstAmount, total: round2(fee + gstAmount),
        finished: period < periodOf(now),            // the real bill is made only after the month ends
        billable: reason === null, reason,
        billedOn: monthStart(nextPeriod(period)),
    });
}));

/* ------------------------------ custom invoice ------------------------------ */
router.post('/tenants/:tid/invoices/custom', loadTenant, wrap(async (req, res) => {
    const body = req.body || {};
    const [tenant, platform] = await Promise.all([
        Tenant.findById(req.tenantDoc._id).select('name phone address business subscription').lean(),
        PlatformSettings.findById('main').lean(),
    ]);
    const b = platform?.business || {};
    if (!b.legalName) throw httpError(400, 'Fill your business details first (PUT /api/admin/platform/business)');

    const raw = body.lineItems;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw httpError(400, 'Send 1 to 20 line items');
    const lineItems = raw.map((l, i) => {
        const description = cleanText(l?.description, 200);
        const qty = Number(l?.qty ?? 1);
        const rate = Number(l?.rate);
        if (!description) throw httpError(400, `Line ${i + 1}: description is missing`);
        if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) throw httpError(400, `Line ${i + 1}: qty must be more than 0`);
        if (!Number.isFinite(rate) || rate < 0 || rate > 10000000) throw httpError(400, `Line ${i + 1}: rate must be a number, 0 or more`);
        return { description, qty, rate: round2(rate), amount: round2(qty * rate) };
    });
    const base = round2(lineItems.reduce((s, l) => s + l.amount, 0));
    if (!(base > 0)) throw httpError(400, 'The invoice total must be more than 0');

    // GST only if you have a GSTIN
    let gstPercent = 0;
    if (b.gstin) {
        gstPercent = body.gstPercent !== undefined ? Number(body.gstPercent) : (tenant.subscription?.gstPercent ?? 18);
        if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 28) throw httpError(400, 'gstPercent must be between 0 and 28');
    }
    const gstAmount = round2((base * gstPercent) / 100);

    const now = new Date();
    const dueDays = body.dueDays === undefined ? (platform?.billing?.dueDays ?? 7) : wholeDays(body.dueDays, 0, 60, 'dueDays');
    const graceDays = body.graceDays === undefined ? (platform?.billing?.graceDays ?? 5) : wholeDays(body.graceDays, 1, 60, 'graceDays');
    const blocksShop = body.blocksShop !== false;   // false = this bill can never pause the shop

    const fy = financialYear(periodOf(now));
    const counter = await Counter.findOneAndUpdate({ _id: `subinv:${fy}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    const invoiceNo = `SUB/${fy}/${String(counter.seq).padStart(4, '0')}`;

    const biz = tenant.business || {};
    const addr = tenant.address || {};
    let inv;
    try {
        inv = await SubscriptionInvoice.create({
            tenantId: tenant._id,
            kind: 'custom',
            invoiceNo,
            issueDate: now,
            dueDate: new Date(now.getTime() + dueDays * DAY_MS),
            graceEndsAt: blocksShop ? new Date(now.getTime() + graceDays * DAY_MS) : undefined,
            description: cleanText(body.description, 200) || lineItems[0].description,
            lineItems,
            baseAmount: base,
            gstPercent,
            gstAmount,
            total: round2(base + gstAmount),
            note: cleanText(body.note, 200),
            markedBy: req.admin.email,
            seller: {
                legalName: b.legalName, address: b.address, gstin: b.gstin, email: b.email, phone: b.phone,
                sacCode: b.sacCode, paymentInstructions: b.paymentInstructions,
            },
            buyer: {
                legalName: biz.legalName || tenant.name,
                address: [addr.line, addr.city, addr.pincode].filter(Boolean).join(', '),
                gstin: biz.gstin,
                phone: tenant.phone,
            },
        });
    } catch (e) {
        await Counter.updateOne({ _id: `subinv:${fy}`, seq: counter.seq }, { $inc: { seq: -1 } });   // keep numbers continuous
        throw e;
    }
    await enforceTenant(tenant._id);
    res.status(201).json(withOverdue(inv.toObject()));
}));

/* ------------------------------ void, waive, extend grace ------------------------------ */
async function cancelInvoice(req, res, defaultReason) {
    if (!isId(req.params.id)) throw httpError(404, 'Invoice not found');
    const reason = cleanText(req.body?.reason, 200) || defaultReason;
    const inv = await SubscriptionInvoice.findOneAndUpdate(
        { _id: req.params.id, status: 'pending' },
        { $set: { status: 'void', voidedAt: new Date(), voidReason: reason, markedBy: req.admin.email } },
        { new: true },
    ).lean();
    if (!inv) {
        const cur = await SubscriptionInvoice.findById(req.params.id).select('status').lean();
        if (!cur) throw httpError(404, 'Invoice not found');
        throw httpError(409, `This invoice is "${cur.status}". Only a pending invoice can be voided or waived`);
    }
    await enforceTenant(inv.tenantId);
    res.json(withOverdue(inv));
}

// Both end the bill and unpause the shop. The difference is only the reason saved with it.
router.patch('/subscriptions/invoices/:id/void', wrap((req, res) => cancelInvoice(req, res, 'Voided by superadmin')));
router.patch('/subscriptions/invoices/:id/waive', wrap((req, res) => cancelInvoice(req, res, 'Waived by superadmin')));

router.patch('/subscriptions/invoices/:id/extend-grace', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Invoice not found');
    const days = wholeDays(req.body?.days, 1, 60, 'days');
    const cur = await SubscriptionInvoice.findById(req.params.id).select('status graceEndsAt tenantId').lean();
    if (!cur) throw httpError(404, 'Invoice not found');
    if (cur.status !== 'pending') throw httpError(409, 'Only a pending invoice can get more grace');

    const now = Date.now();
    const base = Math.max(cur.graceEndsAt ? new Date(cur.graceEndsAt).getTime() : now, now);   // from the old end, or from now if it already ended
    const inv = await SubscriptionInvoice.findByIdAndUpdate(
        req.params.id, { $set: { graceEndsAt: new Date(base + days * DAY_MS) } }, { new: true },
    ).lean();
    await enforceTenant(inv.tenantId);
    res.json(withOverdue(inv));
}));

/* ------------------------------ unpause ------------------------------ */
// Gives every overdue unpaid bill of this shop a new grace window, so the shop can take orders again.
router.post('/tenants/:tid/billing/unpause', loadTenant, wrap(async (req, res) => {
    const t = await Tenant.findById(req.tenantDoc._id).select('billing.state').lean();
    if (t?.billing?.state !== 'paused') throw httpError(409, 'This shop is not paused');
    const platform = await PlatformSettings.findById('main').lean();
    const days = req.body?.days === undefined ? Math.max(platform?.billing?.graceDays ?? 5, 1) : wholeDays(req.body.days, 1, 60, 'days');

    const now = new Date();
    await SubscriptionInvoice.updateMany(
        { tenantId: req.tenantDoc._id, status: 'pending', graceEndsAt: { $lte: now } },
        { $set: { graceEndsAt: new Date(now.getTime() + days * DAY_MS) } },
    );
    await enforceTenant(req.tenantDoc._id, now);
    res.json({ ok: true, graceDays: days });
}));

module.exports = router;