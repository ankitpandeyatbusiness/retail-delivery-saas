const express = require('express');
const tenantRouter = express.Router();
const tenantRecognizer = require('../middlewares/tenantRecognizer');

// Route is now just /theme (mapped to /api/tenants/theme in server.js)
tenantRouter.get('/theme', tenantRecognizer, async (req, res) => {
    // req.tenant is already fetched and verified by the middleware!
    res.json({
        name: req.tenant.name,
        tagline: req.tenant.tagline,
        colors: req.tenant.colors,
        heroImages: req.tenant.heroImages
    });
});

module.exports = tenantRouter;