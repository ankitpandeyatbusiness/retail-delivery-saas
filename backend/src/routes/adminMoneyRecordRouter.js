// What shops paid each month, and the developer's "did you get your part?" answer. Mounted inside adminRouter.
// Every superadmin can READ it (Vivyaan's login too); only the supreme admin changes anything (middlewares/supremeAdmin.js).
//   GET /money-record?month=2026-05                              shops grouped under their brand, what each paid, the developer's part, the answers
//   PUT /money-record/check            (supreme)  { month, tenantId, got: true|false, reason }   reason is needed when got is false
//   PUT /money-record/shops/:tid/brought-by  (supreme)  { broughtBy: "owner" | "partner" }   owner = the developer (70%), partner = Vivyaan (50%)
const express = require('express');
const moneyRecord = require('../services/moneyRecord');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/money-record', wrap(async (req, res) => { res.json(await moneyRecord.monthView(req.query.month || undefined)); }));
router.put('/money-record/check', wrap(async (req, res) => { res.json(await moneyRecord.setCheck(req.body || {}, req.admin)); }));
router.put('/money-record/shops/:tid/brought-by', wrap(async (req, res) => { res.json(await moneyRecord.setBroughtBy(req.params.tid, req.body?.broughtBy)); }));

module.exports = router;
