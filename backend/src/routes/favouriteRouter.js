const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Favourite = require('../models/Favourite');
const Product = require('../models/Product');
const { resolveConfig } = require('../services/tenantConfigService');
const { loadVisibleProducts } = require('../services/visibility');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const MAX_FAVOURITES = 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const scope = (req) => ({ tenantId: req.tenant._id, userId: req.auth.userId });

// Only shops that switched the "favourites" feature on in the panel
router.use(wrap(async (req, res, next) => {
    if (!resolveConfig(req.tenant).features.favourites) throw httpError(404, 'Favourites are not available at this shop');
    next();
}));

// Just the ids: the app uses these to colour the heart on every card
router.get('/ids', wrap(async (req, res) => {
    const rows = await Favourite.find(scope(req)).sort({ createdAt: -1 }).limit(MAX_FAVOURITES).select('productId').lean();
    res.json({ ids: rows.map((r) => String(r.productId)) });
}));

// The "Your favourites" list, newest first. Items that are hidden or removed are left out.
router.get('/', wrap(async (req, res) => {
    const rows = await Favourite.find(scope(req)).sort({ createdAt: -1 }).limit(MAX_FAVOURITES).select('productId').lean();
    const byId = new Map((await loadVisibleProducts(req.tenant, rows.map((r) => r.productId))).map((p) => [String(p._id), p]));
    res.json({ items: rows.map((r) => byId.get(String(r.productId))).filter(Boolean) });
}));

// Adding twice is fine (safe to retry)
router.put('/:productId', wrap(async (req, res) => {
    if (!isId(req.params.productId)) throw httpError(404, 'Item not found');
    const exists = await Product.exists({ _id: req.params.productId, tenantId: req.tenant._id, isActive: true });
    if (!exists) throw httpError(404, 'Item not found');

    const already = await Favourite.exists({ ...scope(req), productId: req.params.productId });
    if (!already && (await Favourite.countDocuments(scope(req))) >= MAX_FAVOURITES) {
        throw httpError(400, `You can save up to ${MAX_FAVOURITES} favourites`);
    }
    await Favourite.updateOne(
        { ...scope(req), productId: req.params.productId },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
    );
    res.json({ ok: true });
}));

router.delete('/:productId', wrap(async (req, res) => {
    if (!isId(req.params.productId)) throw httpError(404, 'Item not found');
    await Favourite.deleteOne({ ...scope(req), productId: req.params.productId });
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;