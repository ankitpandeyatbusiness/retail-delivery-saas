const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Address = require('../models/Address');
const { serviceability } = require('../utils/geo');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);

const FIELDS = ['label', 'name', 'phone', 'line1', 'line2', 'landmark', 'city', 'pincode', 'latitude', 'longitude'];
const MAX_ADDRESSES = 10;

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const num = (v) => (v !== undefined && v !== '' ? Number(v) : NaN);
const pickFields = (body) =>
    Object.fromEntries(FIELDS.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));

// Public: lets the "pick your location" screen check the delivery area before login
router.get('/serviceability', (req, res) => {
    res.json(serviceability(req.tenant, num(req.query.lat), num(req.query.lng)));
});

/* ---------------- everything below needs a logged-in customer ---------------- */
router.use(authenticate);

// tenantId and userId always come from the token, never from the request body
const scope = (req) => ({ tenantId: req.tenant._id, userId: req.auth.userId });

const findOwn = async (req) => {
    const doc = isId(req.params.id) ? await Address.findOne({ _id: req.params.id, ...scope(req) }) : null;
    if (!doc) throw httpError(404, 'Address not found');
    return doc;
};

const checkCoords = (d) => {
    const hasLat = d.latitude !== undefined && d.latitude !== null;
    const hasLng = d.longitude !== undefined && d.longitude !== null;
    if (hasLat !== hasLng) throw httpError(400, 'Send both latitude and longitude');
};

router.get('/', wrap(async (req, res) => {
    const items = await Address.find(scope(req)).sort({ isDefault: -1, createdAt: -1 });
    res.json({ items });
}));

router.post('/', wrap(async (req, res) => {
    const data = pickFields(req.body);
    checkCoords(data);

    const count = await Address.countDocuments(scope(req));
    if (count >= MAX_ADDRESSES) throw httpError(400, `You can save up to ${MAX_ADDRESSES} addresses`);

    const makeDefault = req.body?.isDefault === true || count === 0;
    if (makeDefault) await Address.updateMany({ ...scope(req), isDefault: true }, { isDefault: false });

    const doc = await Address.create({ ...data, ...scope(req), isDefault: makeDefault });
    res.status(201).json(doc);
}));

router.put('/:id', wrap(async (req, res) => {
    const doc = await findOwn(req);
    const data = pickFields(req.body);
    checkCoords(data);

    doc.set(data);
    if (req.body?.isDefault === true && !doc.isDefault) {
        await Address.updateMany({ ...scope(req), isDefault: true }, { isDefault: false });
        doc.isDefault = true;
    }
    await doc.save();
    res.json(doc);
}));

router.delete('/:id', wrap(async (req, res) => {
    const doc = await findOwn(req);
    const wasDefault = doc.isDefault;
    await doc.deleteOne();   // old orders keep their own copy of the address

    if (wasDefault) {
        const next = await Address.findOne(scope(req)).sort({ createdAt: -1 });
        if (next) { next.isDefault = true; await next.save(); }
    }
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;