// The owner's Plan screen. Mounted at /api/shop/plan (owner only; the superadmin sees a shop's plan through /api/admin/tenants/:tid/plan).
//   GET  /                         current plan, dates, days left, all three plans, the wallet (Partner), recent payments, discounts, GST
//   POST /quote                    { to, months } -> exactly what the switch would do and cost (the preview; writes nothing)
//   POST /choose                   { to, months } -> a move that costs nothing: scheduled at the end of the term, or Partner, or a price the wallet covers
//   POST /pay/start                { to, months } -> { paymentId, keyId, rzpOrderId, amountPaise, quote }   the amount is always worked out on the server
//   POST /pay/:id/verify           { razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { paid }
//   DELETE /scheduled              cancel a scheduled move to a lower plan
//   GET  /payments/:id/invoice     the tax invoice data of a paid plan payment
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const billing = require('../services/planBilling');
const platformCheckout = require('../services/platformCheckout');
const PlanPayment = require('../models/PlanPayment');
const brandPlan = require('../services/brandPlan');
const { brandPayer } = require('../middlewares/brandPayer');   // in a brand only the brand owner chooses and pays

const { wrap, httpError } = apiErrors;
const router = express.Router();
const actorOf = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || 'shop owner' };
const mine = async (req) => ({ ...(await brandPlan.planTenant({ ...req.tenant, _id: req.tenant._id })) });   // a brand: the main shop carries the plan and is the one billed

// the superadmin may look (through the shop proxy) but never pay or choose for an owner
router.use((req, res, next) => (req.method !== 'GET' && req.actor?.type === 'superadmin' ? next(httpError(403, 'Only the shop owner can choose or pay for a plan')) : next()));

router.get('/', wrap(async (req, res) => { res.json(await billing.overview(await mine(req))); }));

router.post('/quote', wrap(async (req, res) => { res.json(await billing.quote(await mine(req), { to: req.body?.to, months: req.body?.months })); }));

// ONE extra shop for the brand: the quote, then pay (the same payment screen), then a branch can be created
router.post('/branch/quote', wrap(async (req, res) => { res.json(await billing.quoteBranch(await mine(req))); }));
router.post('/branch/pay/start', brandPayer, wrap(async (req, res) => {
    res.status(201).json(await platformCheckout.startPlan({ tenant: await mine(req), branch: true, actor: actorOf(req) }));
}));

router.post('/choose', brandPayer, wrap(async (req, res) => {
    const t = await mine(req);
    const q = await billing.quote(t, { to: req.body?.to, months: req.body?.months });
    if (q.free && q.kind !== 'downgrade' && q.kind !== 'switch') return res.json(await billing.payFree(t, { to: req.body.to, months: req.body.months }, actorOf(req)));
    res.json(await billing.chooseFree(t, { to: req.body?.to, months: req.body?.months }, actorOf(req)));
}));

router.post('/pay/start', brandPayer, wrap(async (req, res) => {
    res.status(201).json(await platformCheckout.startPlan({ tenant: await mine(req), to: req.body?.to, months: req.body?.months, actor: actorOf(req) }));
}));
router.post('/pay/:id/verify', wrap(async (req, res) => {
    res.json(await platformCheckout.verifyPlan({ tenantId: (await mine(req))._id, paymentId: req.params.id, proof: req.body }));
}));

router.delete('/scheduled', brandPayer, wrap(async (req, res) => { res.json(await billing.cancelScheduled(await mine(req))); }));

router.get('/payments/:id/invoice', wrap(async (req, res) => {
    const r = await PlanPayment.findOne({ _id: req.params.id, tenantId: (await mine(req))._id, status: 'paid' }).lean();
    if (!r) throw httpError(404, 'Payment not found');
    const inv = await billing.ensureInvoice(r._id);
    if (!inv) throw httpError(409, 'The invoice is not ready yet');
    require('../services/subscriptionInvoicePdf').streamSubscriptionInvoice(res, inv, { inline: req.query.view === '1' });   // the tax invoice as a PDF
}));

router.use(apiErrors);
module.exports = router;
