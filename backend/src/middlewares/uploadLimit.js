// Sign limits per day. Uses Mongo so it works across servers. If the limiter itself breaks, uploads stay allowed.
const mongoose = require('mongoose');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const { httpError } = require('./apiErrors');

const cache = {};
const limiter = (prefix, points) => {
    if (!cache[prefix]) {
        cache[prefix] = new RateLimiterMongo({ storeClient: mongoose.connection, points, duration: 24 * 60 * 60, keyPrefix: prefix });
    }
    return cache[prefix];
};

// returns nothing; throws 429 (with err.retryAfter seconds) when the limit is used up
async function takeSignSlot(prefix, key, points) {
    try {
        await limiter(prefix, points).consume(key);
    } catch (e) {
        if (e && typeof e.msBeforeNext === 'number') {
            throw Object.assign(httpError(429, 'Too many uploads today. Please try again tomorrow.'), {
                retryAfter: Math.max(1, Math.ceil(e.msBeforeNext / 1000)),
            });
        }
        // limiter store problem: do not block the shop
    }
}

module.exports = { takeSignSlot };