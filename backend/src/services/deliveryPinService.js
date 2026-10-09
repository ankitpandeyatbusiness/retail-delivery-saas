// Delivery PIN: 4 digits worked out from a secret + the order. Nothing is stored.
// The customer sees it (batch 6.4) and tells it to the rider at the door.
const crypto = require('crypto');
const { httpError } = require('../middlewares/apiErrors');

function pinFor(order) {
    const secret = process.env.DELIVERY_PIN_SECRET;
    if (!secret) throw httpError(500, 'Delivery PIN is not set up on the server');
    const h = crypto.createHmac('sha256', secret).update(`${order.tenantId}:${order._id}`).digest();
    return String(h.readUInt32BE(0) % 10000).padStart(4, '0');
}

function matches(order, input) {
    const want = Buffer.from(pinFor(order));
    const got = Buffer.from(String(input ?? '').trim());
    return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { pinFor, matches };