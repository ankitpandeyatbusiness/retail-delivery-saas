const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const User = require('../models/User');
const { wrap, httpError } = require('../middlewares/apiErrors');

const LANGUAGES = ['en', 'hi', 'bho', 'mr', 'gu', 'bn'];

// Global middleware for this router
// Refresh and logout must work even when the shop is suspended or in maintenance,
// or customers lose their login after 15 minutes.
router.use((req, res, next) => {
    if (req.path === '/refresh' || req.path === '/logout') req.allowFrozenShop = true;
    next();
});
router.use(tenantRecognizer);

// Route Definitions
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

// the language this person reads: notifications and emails to him come in it. { language: 'hi' }
router.put('/language', authenticate, wrap(async (req, res) => {
    const language = req.body?.language;
    if (!LANGUAGES.includes(language)) throw httpError(400, `language must be one of: ${LANGUAGES.join(', ')}`);
    await User.updateOne({ _id: req.auth.userId, tenantId: req.tenant._id }, { $set: { language } });
    res.json({ ok: true, language });
}));

module.exports = router;