const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const apiErrors = require('../middlewares/apiErrors');
const Collection = require('../models/Collection');
const { activeNow } = require('../services/catalogQuery');
const { loadVisibleProducts } = require('../services/visibility');

const { wrap } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);

// GET /api/catalog/collections?kind=festival   (or kind=combo, or leave out for both)
// Only collections that are active right now and still have at least one visible item are returned.
router.get('/', wrap(async (req, res) => {
    const filter = { tenantId: req.tenant._id, ...activeNow() };
    if (['festival', 'combo'].includes(req.query.kind)) filter.kind = req.query.kind;

    const cols = await Collection.find(filter).sort({ sortOrder: 1, _id: 1 }).limit(10).lean();
    const ids = [...new Set(cols.flatMap((c) => c.productIds.map(String)))];
    const byId = new Map((await loadVisibleProducts(req.tenant, ids)).map((p) => [String(p._id), p]));

    const items = cols
        .map((c) => ({
            id: c._id, kind: c.kind, title: c.title, subtitle: c.subtitle, image: c.image, endsAt: c.endsAt,
            products: c.productIds.map((id) => byId.get(String(id))).filter(Boolean),   // keeps the order you set
        }))
        .filter((c) => c.products.length);
    res.json({ items });
}));

router.use(apiErrors);
module.exports = router;