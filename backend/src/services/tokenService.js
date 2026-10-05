const jwt = require('jsonwebtoken');

class TokenService {
    generateTokens(userId) {
        const accessToken = jwt.sign(
            { userId },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
        );

        const refreshToken = jwt.sign(
            { userId },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
        );

        return { accessToken, refreshToken };
    }

    verifyAccessToken(token) {
        return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    }

    verifyRefreshToken(token) {
        return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    }
}

module.exports = new TokenService();