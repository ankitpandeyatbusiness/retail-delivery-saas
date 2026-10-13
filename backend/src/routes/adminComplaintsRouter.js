// Superadmin: all complaints.  GET /api/admin/complaints?status=&tenantId=&page=
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const complaints = require('../services/complaintService');

const router = express.Router();

router.get('/complaints', apiErrors.wrap(async (req, res) => {
    res.json(await complaints.adminList({ query: req.query }));
}));

router.use(apiErrors);
module.exports = router;