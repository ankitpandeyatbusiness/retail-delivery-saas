const express = require('express');
const mongoose = require('mongoose');
const { wrap, httpError } = require('../middlewares/apiErrors');

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pickFields = (fields, body) =>
    Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));

// One reusable set of routes: list, create, read, update (PUT or PATCH), delete.
// Only whitelisted fields are accepted, and the shop always comes from req.tenantDoc (never from the body).
function crud(Model, { fields, sort, searchField, softDelete, check }) {
    const r = express.Router({ mergeParams: true });
    const scope = (req) => ({ tenantId: req.tenantDoc._id });
    const findOneDoc = (req) =>
        isId(req.params.id) ? Model.findOne({ _id: req.params.id, ...scope(req) }) : Promise.resolve(null);

    r.get('/', wrap(async (req, res) => {
        const page = clamp(parseInt(req.query.page, 10) || 1, 1, 10000);
        const limit = clamp(parseInt(req.query.limit, 10) || 50, 1, 100);
        const f = scope(req);
        if (req.query.active === 'true') f.isActive = true;
        if (req.query.active === 'false') f.isActive = false;
        if (Model.schema.path('categoryId') && isId(req.query.categoryId)) f.categoryId = req.query.categoryId;
        if (searchField && typeof req.query.q === 'string' && req.query.q.trim()) {
            f[searchField] = new RegExp(esc(req.query.q.trim().slice(0, 40)), 'i');
        }
        const [items, total] = await Promise.all([
            Model.find(f).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
            Model.countDocuments(f),
        ]);
        res.json({ items, total, page, limit });
    }));

    r.post('/', wrap(async (req, res) => {
        const data = pickFields(fields, req.body);
        if (check) await check(data, req);
        const doc = new Model({ ...data, ...scope(req) });
        await doc.save();
        res.status(201).json(doc);
    }));

    r.get('/:id', wrap(async (req, res) => {
        const doc = await findOneDoc(req);
        if (!doc) throw httpError(404, 'Not found');
        res.json(doc);
    }));

    const update = wrap(async (req, res) => {
        const doc = await findOneDoc(req);
        if (!doc) throw httpError(404, 'Not found');
        const data = pickFields(fields, req.body);
        if (check) await check({ ...doc.toObject(), ...data }, req);
        doc.set(data);
        await doc.save();
        res.json(doc);
    });
    r.put('/:id', update);
    r.patch('/:id', update);

    r.delete('/:id', wrap(async (req, res) => {
        const doc = await findOneDoc(req);
        if (!doc) throw httpError(404, 'Not found');
        if (softDelete) { doc.isActive = false; await doc.save(); }   // keeps old orders readable
        else await doc.deleteOne();
        res.json({ ok: true, softDeleted: !!softDelete });
    }));

    return r;
}

module.exports = crud;