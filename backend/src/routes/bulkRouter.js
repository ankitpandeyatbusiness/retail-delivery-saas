// Bulk orders, the customer's side. Mounted at /api/bulk.
//   GET  /config               the shop's bulk rules (minimums, notice, fee, advance)
//   GET  /menu                 the whole menu with every option and the bulk prices
//   POST /estimate             { fulfilment, when, addressId?, items: [{ productId, quantity, selections }] } -> the price, live, nothing saved
//   POST /                     the same + { contact, cutlery, packaging, note }: send the request to the shop
//   GET  /mine                 what this customer asked
//   GET  /:id                  one bulk order with the shop's quote
//   POST /:id/cancel           cancel before anything is paid
//   POST /:id/change           { note }: ask the shop to change its quote
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const featureGate = require('../services/featureGate');
const bulk = require('../services/bulkOrders');
const pay = require('../services/bulkPayment');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);
// a shop without the Services switch has no bulk orders; a customer's existing orders stay readable
router.use((req, res, next) => {
    if (featureGate.isOn(req.tenant, 'services') || (req.method === 'GET' && req.path !== '/menu' && req.path !== '/config')) return next();
    if (req.method === 'GET' && req.path === '/config') return res.json({ enabled: false });
    return next(httpError(404, 'Bulk orders are not available at this shop'));
});

router.get('/config', wrap(async (req, res) => { res.json(bulk.publicConfig(await bulk.settingsOf(req.tenant._id))); }));
router.get('/menu', wrap(async (req, res) => { await bulk.settingsOf(req.tenant._id); res.json(await bulk.menuFor(req.tenant)); }));
router.post('/estimate', wrap(async (req, res) => { res.json(await bulk.estimate({ tenant: req.tenant, userId: req.auth.userId, body: req.body || {} })); }));
router.post('/', wrap(async (req, res) => {
    const r = await bulk.create({ tenant: req.tenant, userId: req.auth.userId, body: req.body || {} });
    res.status(r.duplicate ? 200 : 201).json(bulk.customerView(r.order));
}));
router.get('/mine', wrap(async (req, res) => { res.json({ items: await bulk.listMine({ tenant: req.tenant, userId: req.auth.userId }) }); }));
router.get('/:id', wrap(async (req, res) => { res.json(bulk.customerView(await bulk.mine({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id }))); }));
router.get('/:id/cancel-preview', wrap(async (req, res) => { res.json(await bulk.previewCancel({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })); }));
// paying the advance of an accepted quote (the shop's own Razorpay keys): start, then the proof, or ask Razorpay
router.post('/:id/pay', wrap(async (req, res) => { res.json(await pay.startAdvance({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })); }));
router.post('/:id/verify', wrap(async (req, res) => {
    const b = req.body || {};
    const [rzpOrderId, rzpPaymentId, signature] = [b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature];
    if (![rzpOrderId, rzpPaymentId, signature].every((v) => typeof v === 'string' && v && v.length <= 100)) throw httpError(400, 'Payment details are missing');
    const r = await pay.verifyAdvance({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id, rzpOrderId, rzpPaymentId, signature });
    res.json({ paid: !!r.paid, status: r.status || null, order: bulk.customerView(await bulk.mine({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })) });
}));
router.post('/:id/check', wrap(async (req, res) => {
    let r;
    try { r = await pay.checkAdvance({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id }); } catch (e) { if (e.status === 404) throw e; r = { paid: false, status: 'unknown' }; }   // Razorpay not reachable: "not known yet"
    res.json({ paid: !!r.paid, status: r.status || null, order: bulk.customerView(await bulk.mine({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })) });
}));
router.post('/:id/cancel', wrap(async (req, res) => { res.json(await bulk.cancelByCustomer({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })); }));
router.post('/:id/change', wrap(async (req, res) => { res.json(await bulk.askChange({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id, note: req.body?.note })); }));

router.use(apiErrors);
module.exports = router;
