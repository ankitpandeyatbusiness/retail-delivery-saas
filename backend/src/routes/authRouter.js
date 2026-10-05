const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tenantRecognizer = require('../middlewares/tenantRecognizer');

// Global middleware for this router
router.use(tenantRecognizer);

// Route Definitions
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

module.exports = router;