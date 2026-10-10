const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tenantRecognizer = require('../middlewares/tenantRecognizer');

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

module.exports = router;