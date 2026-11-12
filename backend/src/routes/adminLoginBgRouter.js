// Login backgrounds (the picture behind the desktop website's login page). Mounted inside adminRouter (after requireSuperAdmin).
// Everybody with a superadmin login can look and choose a picture for a shop; only the supreme admin changes the library (upload, default, delete).
//   GET    /login-backgrounds                          every business type with its pictures, its default and how many shops use each
//   POST   /login-backgrounds/sign                     { contentType, bytes }  -> a one-time address to PUT the raw file to        (supreme admin)
//   POST   /login-backgrounds/confirm                  { businessType, name, key }  -> the picture, converted and stored         (supreme admin)
//   PUT    /login-backgrounds/default                  { businessType, file }  the picture a business type shows by default     (supreme admin)
//   DELETE /login-backgrounds?businessType=&file=      (or the same in the body)  (not the default, not one a shop uses)           (supreme admin)
//   PUT    /tenants/:tid/login-bg                      { rel: "restaurant/food-doodles-dark.webp" | null }  one shop's choice (null = the default)
const express = require('express');
const loadTenant = require('../middlewares/loadTenant');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap, httpError } = require('../middlewares/apiErrors');
const bg = require('../services/loginBackgrounds');
const tenantRecognizer = require('../middlewares/tenantRecognizer');

const router = express.Router();

router.get('/login-backgrounds', wrap(async (req, res) => {
    res.json({ types: await bg.overview() });
}));

router.post('/login-backgrounds/sign', requireSupreme, wrap(async (req, res) => {
    res.json(await bg.sign({ contentType: req.body && req.body.contentType, bytes: req.body && req.body.bytes }));
}));

router.post('/login-backgrounds/confirm', requireSupreme, wrap(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await bg.confirm({ type: b.businessType, name: b.name, key: b.key }));
}));

router.put('/login-backgrounds/default', requireSupreme, wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await bg.setDefault(b.businessType, b.file));
}));

router.delete('/login-backgrounds', requireSupreme, wrap(async (req, res) => {
    const b = { ...req.query, ...(req.body || {}) };   // a DELETE may carry the choice in the address
    await bg.remove(b.businessType, b.file);
    res.json({ ok: true });
}));

router.put('/tenants/:tid/login-bg', loadTenant, wrap(async (req, res) => {
    const rel = req.body ? req.body.rel : undefined;
    if (rel !== null && typeof rel !== 'string') throw httpError(400, 'Send rel: a picture name, or null for the default');
    const saved = await bg.setForShop(req.tenantDoc._id, rel);
    tenantRecognizer.invalidateTenant(req.tenantDoc.slug);   // the next theme answer already carries it
    res.json({ rel: saved });
}));

module.exports = router;
