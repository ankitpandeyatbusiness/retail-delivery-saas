// Superadmin: emergency refunds of real money to a shop (plan payments, Partner wallet, SMS balance). Mounted inside adminRouter. Supreme admin only
// (reads too: it shows money); moneyGuard lists the writes as well.
//
//   GET  /api/admin/tenants/:tid/refunds   what can be refunded (per plan payment, wallet and SMS balance, with a suggested amount) and the history
//   POST /api/admin/tenants/:tid/refunds   { kind: 'plan'|'wallet'|'sms', requestId, reason, amountPaise, sourceId? (plan), endPlan? (plan, default true) }
const express = require('express');
const loadTenant = require('../middlewares/loadTenant');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap, httpError } = require('../middlewares/apiErrors');
const refunds = require('../services/emergencyRefund');

const router = express.Router();
const byOf = (req) => req.admin?.phone || req.admin?.email || 'supreme admin';

router.get('/tenants/:tid/refunds', requireSupreme, loadTenant, wrap(async (req, res) => {
    res.json(await refunds.overview(req.tenantDoc));
}));

router.get('/tenants/:tid/refunds/:id/credit-note', requireSupreme, loadTenant, wrap(async (req, res) => {
    const PlatformRefund = require('../models/PlatformRefund');
    const r = /^[0-9a-f]{24}$/.test(req.params.id) ? await PlatformRefund.findOne({ _id: req.params.id, tenantId: req.tenantDoc._id }).select('_id').lean() : null;
    if (!r) throw httpError(404, 'Refund not found');
    const note = await refunds.ensureCreditNote(r._id);
    if (!note) throw httpError(409, 'The credit note is not ready. Fill in the business details first.');
    require('../services/subscriptionInvoicePdf').streamSubscriptionInvoice(res, note, { inline: req.query.view === '1', creditNote: true });
}));

router.post('/tenants/:tid/refunds', requireSupreme, loadTenant, wrap(async (req, res) => {
    const b = req.body || {};
    const reason = String(b.reason || '').trim();
    if (reason.length < 5) throw httpError(400, 'Write the reason for this refund');
    const requestId = String(b.requestId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,60}$/.test(requestId)) throw httpError(400, 'The request id is missing');
    const amountPaise = Number(b.amountPaise);
    const note = reason.slice(0, 300);
    let r;
    if (b.kind === 'plan') r = await refunds.refundPlan({ tenant: req.tenantDoc, sourceId: b.sourceId, amountPaise, endPlan: b.endPlan !== false, reason: note, requestId, by: byOf(req) });
    else if (b.kind === 'wallet' || b.kind === 'sms') r = await refunds.refundWallet({ tenant: req.tenantDoc, kind: b.kind, amountPaise, reason: note, requestId, by: byOf(req) });
    else throw httpError(400, 'Choose plan, wallet or sms');
    if (!r.duplicate && (r.status === 'processed' || r.processed)) {
        try {
            const what = b.kind === 'plan' ? 'plan payment' : b.kind === 'wallet' ? 'wallet balance' : 'SMS balance';
            await require('../notifications/center').notify('plan_changed', { tenantId: req.tenantDoc._id, title: 'A refund was sent', body: `We sent back part of your ${what} to your payment method. It reaches you in 5 to 7 working days.`, vars: { summary: `Refund of your ${what}: ${reason}` }, data: { prompt: 'plan' } });
        } catch (e) { /* the refund is done; a missing push must not undo it */ }
    }
    res.status(r.duplicate ? 200 : 201).json(r);
}));

module.exports = router;
