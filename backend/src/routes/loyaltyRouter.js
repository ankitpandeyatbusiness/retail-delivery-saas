// The customer's points at this shop.  GET /api/loyalty/me  ->  { enabled, balance, pending: { points, nextAt }, rules, history }
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const loyalty = require('../services/loyaltyService');

const { wrap } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

router.get('/me', wrap(async (req, res) => {
    res.json(await loyalty.customerView(req.tenant, req.auth.userId));
}));

router.use(apiErrors);
module.exports = router;
