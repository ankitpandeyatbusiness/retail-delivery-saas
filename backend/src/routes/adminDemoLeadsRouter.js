// Superadmin: the people who left their details after trying the public demo. Mounted inside adminRouter (after requireSuperAdmin).
//   GET    /api/admin/demo-leads?status=new|called&q=&page=   { items, hasMore, total, new, page }
//   PATCH  /api/admin/demo-leads/:id    { status?: 'new'|'called', note? }
//   DELETE /api/admin/demo-leads/:id
const express = require('express');
const leads = require('../services/demoLeads');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v));

router.get('/demo-leads', wrap(async (req, res) => {
    res.json(await leads.list({ status: req.query.status, q: req.query.q, page: Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500) }));
}));
router.patch('/demo-leads/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Lead not found');
    res.json(await leads.update(req.params.id, req.body));
}));
router.delete('/demo-leads/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Lead not found');
    res.json(await leads.remove(req.params.id));
}));

module.exports = router;
