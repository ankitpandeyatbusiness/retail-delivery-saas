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
router.post('/:id/cancel', wrap(async (req, res) => { res.json(await bulk.cancelByCustomer({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id })); }));
router.post('/:id/change', wrap(async (req, res) => { res.json(await bulk.askChange({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id, note: req.body?.note })); }));

router.use(apiErrors);
module.exports = router;
