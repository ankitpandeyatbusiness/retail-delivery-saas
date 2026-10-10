// Slows down one IP on public routes (catalog, shop info, serviceability).
// Memory based: fine for one server. 300 requests per minute per IP by default.
const { RateLimiterMemory } = require('rate-limiter-flexible');

function make({ points = 300, duration = 60 } = {}) {
    const limiter = new RateLimiterMemory({ points, duration });
    return async (req, res, next) => {
        try {
            await limiter.consume(req.ip || 'unknown');
            next();
        } catch (rej) {
            if (rej instanceof Error) return next();   // the limiter itself failed: let the request through
            const retryAfter = Math.max(1, Math.ceil((rej.msBeforeNext || 1000) / 1000));
            res.set('Retry-After', String(retryAfter));
            res.status(429).json({ error: 'Too many requests. Please wait and try again.', retryAfter });
        }
    };
}

module.exports = make();
module.exports.make = make;