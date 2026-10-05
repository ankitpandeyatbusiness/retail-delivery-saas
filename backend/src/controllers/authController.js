const User = require('../models/User');
const tokenService = require('../services/tokenService');

// Mock OTP Store
const otpStore = new Map();

exports.sendOtp = async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    try {
        const tenant = req.tenant;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        otpStore.set(`${tenant._id}-${phone}`, otp);

        // TODO: DLT SMS API call here
        console.log(`\n[MOCK SMS] 🚀 OTP ${otp} to ${phone} for ${tenant.name}\n`);

        res.json({ success: true, message: 'OTP sent' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

exports.verifyOtp = async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Missing data' });

    try {
        const tenant = req.tenant;
        const storeKey = `${tenant._id}-${phone}`;
        const storedOtp = otpStore.get(storeKey);

        if (!storedOtp || storedOtp !== otp) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        otpStore.delete(storeKey);

        let user = await User.findOne({ tenantId: tenant._id, phone });
        if (!user) {
            user = await User.create({ tenantId: tenant._id, phone });
        }

        // Generate both tokens
        const { accessToken, refreshToken } = tokenService.generateTokens(user._id);

        // Save refresh token to DB to authorize future access tokens
        user.refreshTokens.push(refreshToken);
        await user.save();

        res.json({ success: true, user, accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
};

exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    try {
        // 1. Verify token cryptographic signature
        const decoded = tokenService.verifyRefreshToken(refreshToken);

        // 2. Verify token actually exists in the database (hasn't been revoked/logged out)
        const user = await User.findById(decoded.userId);
        if (!user || !user.refreshTokens.includes(refreshToken)) {
            return res.status(403).json({ error: 'Invalid or revoked refresh token' });
        }

        // 3. Issue a fresh Access Token
        const tokens = tokenService.generateTokens(user._id);

        // Token Rotation (Security Best Practice): Replace old refresh token with a new one
        user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
        user.refreshTokens.push(tokens.refreshToken);
        await user.save();

        res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    } catch (error) {
        res.status(403).json({ error: 'Invalid refresh token' });
    }
};

exports.logout = async (req, res) => {
    const { refreshToken } = req.body;
    try {
        const decoded = tokenService.verifyRefreshToken(refreshToken);
        const user = await User.findById(decoded.userId);

        if (user) {
            // Remove this specific device's token from the database
            user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
            await user.save();
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
};