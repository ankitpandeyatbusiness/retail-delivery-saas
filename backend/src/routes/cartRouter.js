// The customer's cart on the server (web phase 12): the phone app and the website show the same cart.
//   GET    /api/cart        { lines, updatedAt }
//   PUT    /api/cart        { lines }   replaces the cart (the last change wins). Answers { lines, updatedAt }
//   DELETE /api/cart        empties it
// Every change is announced to the person's other devices by middlewares/syncNotify.js (area "cart"), which then fetch it again.
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Cart = require('../models/Cart');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const MAX_LINES = 60;
const MAX_LINE_JSON = 3000;

// plain JSON only, no keys that start with $ or contain a dot (they have a meaning in the database), not too deep
function plain(v, depth = 0) {
    if (depth > 4) throw httpError(400, 'Invalid cart');
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        if (typeof v === 'number' && !Number.isFinite(v)) throw httpError(400, 'Invalid cart');
        return v;
    }
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => plain(x, depth + 1));
    if (typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            if (k.startsWith('$') || k.includes('.')) throw httpError(400, 'Invalid cart');
            if (x === undefined || typeof x === 'function') continue;
            out[k] = plain(x, depth + 1);
        }
        return out;
    }
    throw httpError(400, 'Invalid cart');
}

function clean(lines) {
    if (!Array.isArray(lines)) throw httpError(400, 'lines must be a list');
    if (lines.length > MAX_LINES) throw httpError(400, 'Too many items in the cart');
    return lines.map((l) => {
        if (!l || typeof l !== 'object' || Array.isArray(l)) throw httpError(400, 'Invalid cart');
        if (typeof l.key !== 'string' || !l.key || l.key.length > 300) throw httpError(400, 'Invalid cart');
        if (typeof l.productId !== 'string' || !l.productId || l.productId.length > 60) throw httpError(400, 'Invalid cart');
        const q = Number(l.quantity);
        if (!Number.isFinite(q) || q < 1 || q > 20) throw httpError(400, 'Invalid cart');
        const p = Number(l.price);
        if (!Number.isFinite(p) || p < 0 || p > 10000000) throw httpError(400, 'Invalid cart');
        const out = plain(l);
        if (JSON.stringify(out).length > MAX_LINE_JSON) throw httpError(400, 'Invalid cart');
        return out;
    });
}

const scope = (req) => ({ tenantId: req.tenant._id, userId: req.auth.userId });
const shape = (c) => ({ lines: c ? c.lines : [], updatedAt: c ? c.updatedAt : null });

router.get('/', wrap(async (req, res) => {
    res.json(shape(await Cart.findOne(scope(req)).lean()));
}));

router.put('/', wrap(async (req, res) => {
    const lines = clean(req.body && req.body.lines);
    const c = await Cart.findOneAndUpdate(scope(req), { $set: { lines } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    res.json(shape(c));
}));

router.delete('/', wrap(async (req, res) => {
    await Cart.deleteOne(scope(req));
    res.json({ lines: [], updatedAt: null });
}));

router.use(apiErrors);
module.exports = router;
