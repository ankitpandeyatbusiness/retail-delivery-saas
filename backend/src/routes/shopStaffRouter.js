// Owner (and superadmin) staff tools. Reads req.tenant, so it is mounted twice like the other shop routes.
//   GET / list · POST / add { phone, name, role } · PATCH /:userId { isActive, name, role } · DELETE /:userId
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const staff = require('../services/staffService');

const { wrap, httpError } = apiErrors;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const router = express.Router();

router.get('/', wrap(async (req, res) => { res.json(await staff.list(req.tenant)); }));

router.post('/', wrap(async (req, res) => {
    const r = await staff.add({ tenant: req.tenant, phone: req.body?.phone, name: req.body?.name, role: req.body?.role });
    res.status(r.added ? 201 : 200).json(r);
}));

router.patch('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Staff member not found');
    const { isActive, name, role } = req.body || {};
    if (isActive === undefined && name === undefined && role === undefined) throw httpError(400, 'Nothing to update');
    res.json(await staff.update({ tenant: req.tenant, userId: req.params.userId, isActive, name, role }));
}));

router.delete('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Staff member not found');
    res.json(await staff.remove({ tenant: req.tenant, userId: req.params.userId }));
}));

module.exports = router;
