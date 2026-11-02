// Bulk orders, the owner's side. Mounted under /api/shop/bulk (the owner chain already ran).
//   GET  /settings   PUT /settings     the bulk rules: minimums, notice, delivery fee, advance
//   GET  /?status=requested|quoted|open|...   the list
//   GET  /:id                          one order with the customer's details
//   POST /:id/quote                    { lines: [{ id, unitPrice }], discount?, deliveryFee?, packagingCharge?, advancePercent?, validHours?, note? }
//   POST /:id/decline                  { reason }
//   POST /:id/cancel                   { reason }  a confirmed order: everything goes back to the customer
//   POST /:id/stage                    { to }  preparing | ready | out_for_delivery | delivered
//   POST /:id/cash-received            the customer paid the balance in cash
//   GET  /:id/invoice                  the PDF of a completed order
//   PUT  /:id/note                     { note }  private
//
// The super admin's Bulk orders switch for the shop (featureGate 'bulkOrders'):
//   off -> the owner cannot change the rules or switch bulk on (he can still switch it OFF), and no new request can come in (routes/bulkRouter.js);
//          orders already taken are still listed and finished (quote, stages, cash, cancel, invoice), because customers have paid money for them.
//   on  -> the owner sets the rules and the bulk prices of his dishes, and can switch bulk ordering off and on himself ("enabled").
// The super admin himself can always change the rules of any shop.
const express = require('express');
const { wrap, httpError } = require('../middlewares/apiErrors');
const featureGate = require('../services/featureGate');
const bulk = require('../services/bulkOrders');

const router = express.Router();

const isSuper = (req) => req.actor?.type === 'superadmin';
const featureOn = (req) => featureGate.isOn(req.tenant, 'bulkOrders');

router.get('/settings', wrap(async (req, res) => { res.json({ ...(await bulk.settingsOf(req.tenant._id)), featureOn: featureOn(req), recommended: bulk.RECOMMENDED }); }));
router.put('/settings', wrap(async (req, res) => {
    const body = req.body || {};
    const onlySwitchOff = Object.keys(body).length === 1 && body.enabled === false;
    if (!featureOn(req) && !isSuper(req) && !onlySwitchOff) throw httpError(403, 'Bulk orders are not switched on for your shop. Ask us to switch it on.');
    res.json({ ...(await bulk.saveSettings(req.tenant._id, body)), featureOn: featureOn(req) });
}));
router.get('/', wrap(async (req, res) => { res.json(await bulk.ownerList({ tenant: req.tenant, status: req.query.status, page: req.query.page })); }));
router.get('/:id', wrap(async (req, res) => { res.json(bulk.ownerView(await bulk.ownerOne({ tenant: req.tenant, id: req.params.id }))); }));
router.post('/:id/quote', wrap(async (req, res) => { res.json(await bulk.quote({ tenant: req.tenant, id: req.params.id, body: req.body || {} })); }));
router.post('/:id/decline', wrap(async (req, res) => { res.json(await bulk.decline({ tenant: req.tenant, id: req.params.id, reason: req.body?.reason })); }));
router.post('/:id/cancel', wrap(async (req, res) => { res.json(await bulk.ownerCancel({ tenant: req.tenant, id: req.params.id, reason: req.body?.reason })); }));   // a paid order: the customer gets the whole advance back
router.post('/:id/stage', wrap(async (req, res) => { res.json(await bulk.setStage({ tenant: req.tenant, id: req.params.id, to: req.body?.to })); }));   // preparing | ready | out_for_delivery | delivered
router.post('/:id/cash-received', wrap(async (req, res) => { res.json(await bulk.markCash({ tenant: req.tenant, id: req.params.id })); }));   // the balance was paid in cash
router.get('/:id/invoice', wrap(async (req, res) => {
    const { order, tenant } = await bulk.invoiceFor({ tenant: req.tenant, id: req.params.id });
    require('../services/invoiceService').streamInvoice(res, order, tenant, { inline: req.query.view === '1' });
}));
router.put('/:id/note', wrap(async (req, res) => { res.json(await bulk.setOwnerNote({ tenant: req.tenant, id: req.params.id, note: req.body?.note })); }));

module.exports = router;
