// Owner (and superadmin) customer tools. Mounted at /api/shop/customers (also through the superadmin shop mount).
//   PATCH /:userId/cod-block   { blocked: false }   allow Cash on delivery again for this person (his strikes go back to 0)
// The customer list and edit routes come in a later batch.
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const CustomerRisk = require('../models/CustomerRisk');
const { hashPhone } = require('../utils/phoneHash');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

router.patch('/:userId/cod-block', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Customer not found');
    if (req.body?.blocked !== false) throw httpError(400, 'Send blocked: false to allow Cash on delivery again');

    const tenantId = req.tenant._id;
    const user = await User.findOne({ _id: req.params.userId, tenantId }).select('phone phoneHash').lean();
    if (!user) throw httpError(404, 'Customer not found');

    const phoneHash = user.phoneHash || hashPhone(tenantId, user.phone);
    req.auditBefore = (await CustomerRisk.findOne({ tenantId, phoneHash }).lean()) || undefined;
    await CustomerRisk.updateOne(
        { tenantId, phoneHash },
        { $set: { codBlocked: false, strikes: 0 }, $unset: { codBlockedAt: 1 } },
    );
    res.json({ ok: true, codBlocked: false, strikes: 0 });
}));

router.use(apiErrors);
module.exports = router;