// Owner (and superadmin) COD cash and rider performance. Reads req.tenant, so it is mounted twice.
//   GET  /riders                     who owes how much
//   GET  /riders/:userId/ledger      history of one rider (?page=1&limit=20)
//   POST /riders/:userId/handover    { amountPaise, note? }  rider gave cash to the shop
//   POST /riders/:userId/adjust      { amountPaise (+ or -), note }  manual fix
//   GET  /performance                ?from=2026-10-01&to=2026-10-31 (default: last 30 days)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const cod = require('../services/codService');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

const IST_MS = 330 * 60000;
const day = (v, endOfDay) => {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) throw httpError(400, 'Dates must look like 2026-10-31');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw httpError(400, 'Invalid date');
    return new Date(Date.UTC(y, mo - 1, d) - IST_MS + (endOfDay ? 86400000 - 1 : 0));
};

router.get('/riders', wrap(async (req, res) => {
    res.json(await cod.balances(req.tenant._id));
}));

router.get('/riders/:userId/ledger', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.json(await cod.ledger({
        tenantId: req.tenant._id, riderId: req.params.userId,
        page: clamp(parseInt(req.query.page, 10) || 1, 1, 1000),
        limit: clamp(parseInt(req.query.limit, 10) || 20, 1, 50),
    }));
}));

router.post('/riders/:userId/handover', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.status(201).json(await cod.record({
        tenantId: req.tenant._id, riderId: req.params.userId, type: 'handover',
        amountPaise: req.body?.amountPaise, note: req.body?.note, actor: actorOf(req),
    }));
}));

router.post('/riders/:userId/adjust', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.status(201).json(await cod.record({
        tenantId: req.tenant._id, riderId: req.params.userId, type: 'adjust',
        amountPaise: req.body?.amountPaise, note: req.body?.note, actor: actorOf(req),
    }));
}));

router.get('/performance', wrap(async (req, res) => {
    const to = req.query.to ? day(req.query.to, true) : new Date();
    const from = req.query.from ? day(req.query.from, false) : new Date(to.getTime() - 30 * 86400000);
    if (from > to) throw httpError(400, 'The "from" date must not be after the "to" date');
    res.json(await cod.performance({ tenantId: req.tenant._id, from, to }));
}));

router.use(apiErrors);
module.exports = router;