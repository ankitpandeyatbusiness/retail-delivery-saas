// Bulk orders, the owner's side. Mounted under /api/shop/bulk (the owner chain already ran).
//   GET  /settings   PUT /settings     the bulk rules: minimums, notice, delivery fee, advance
//   GET  /?status=requested|quoted|open|...   the list
//   GET  /:id                          one order with the customer's details
//   POST /:id/quote                    { lines: [{ id, unitPrice }], discount?, deliveryFee?, packagingCharge?, advancePercent?, validHours?, note? }
//   POST /:id/decline                  { reason }
//   PUT  /:id/note                     { note }  private
const express = require('express');
const { wrap } = require('../middlewares/apiErrors');
const bulk = require('../services/bulkOrders');

const router = express.Router();

router.get('/settings', wrap(async (req, res) => { res.json(await bulk.settingsOf(req.tenant._id)); }));
router.put('/settings', wrap(async (req, res) => { res.json(await bulk.saveSettings(req.tenant._id, req.body || {})); }));
router.get('/', wrap(async (req, res) => { res.json(await bulk.ownerList({ tenant: req.tenant, status: req.query.status, page: req.query.page })); }));
router.get('/:id', wrap(async (req, res) => { res.json(bulk.ownerView(await bulk.ownerOne({ tenant: req.tenant, id: req.params.id }))); }));
router.post('/:id/quote', wrap(async (req, res) => { res.json(await bulk.quote({ tenant: req.tenant, id: req.params.id, body: req.body || {} })); }));
router.post('/:id/decline', wrap(async (req, res) => { res.json(await bulk.decline({ tenant: req.tenant, id: req.params.id, reason: req.body?.reason })); }));
router.put('/:id/note', wrap(async (req, res) => { res.json(await bulk.setOwnerNote({ tenant: req.tenant, id: req.params.id, note: req.body?.note })); }));

module.exports = router;
