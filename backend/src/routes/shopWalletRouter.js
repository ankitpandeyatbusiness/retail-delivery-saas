// The owner's Partner wallet. Mounted at /api/shop/wallet (also reachable by the superadmin through the shop proxy, read only there).
//   GET  /                       balance, overdraft, low/zero flags, packs, GST, and the fee range (never the slab table)
//   GET  /history                every movement ("Order #1042, Rs 420, fee Rs 9") and the fees this month
//   POST /topup/start            { amountPaise } -> { topupId, keyId, rzpOrderId, amountPaise, currency }
//   POST /topup/:id/verify       { razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { paid }
// Only a Partner shop has a wallet. Growth and Pro pay a plan price instead.
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const wallet = require('../services/partnerWalletService');
const topups = require('../services/partnerTopupService');
const platformCheckout = require('../services/platformCheckout');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const actorOf = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || 'shop owner' };

router.use((req, res, next) => (wallet.isPartner(req.tenant) ? next() : next(httpError(404, 'The wallet is only in the Partner plan'))));

router.get('/', wrap(async (req, res) => {
    const [s, o] = await Promise.all([wallet.status(req.tenant._id), topups.options()]);
    res.json({ ...s, packs: o.packs, minPaise: o.minPaise, maxPaise: o.maxPaise, gstPercent: o.gstPercent });
}));

router.get('/history', wrap(async (req, res) => {
    res.json(await wallet.history(req.tenant._id, { limit: parseInt(req.query.limit, 10) || 50 }));
}));

router.post('/topup/start', wrap(async (req, res) => {
    res.status(201).json(await platformCheckout.startPartnerTopup({ tenantId: req.tenant._id, amountPaise: req.body?.amountPaise, actor: actorOf(req) }));
}));
router.post('/topup/:id/verify', wrap(async (req, res) => {
    res.json(await platformCheckout.verifyPartnerTopup({ tenantId: req.tenant._id, topupId: req.params.id, proof: req.body }));
}));

router.use(apiErrors);
module.exports = router;
