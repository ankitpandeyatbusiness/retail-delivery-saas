// Platform health: everything the supreme admin needs to see whether the platform is running fine. Mounted inside adminRouter. Read only; every superadmin may look.
//   GET /platform/health   { overall, needsYou, system, payments, sms, rent, orders, google, shops, support, quiet, versions, notTracked }
const express = require('express');
const health = require('../services/platformHealth');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/platform/health', wrap(async (req, res) => { res.json(await health.build()); }));

module.exports = router;
