// Quick check that live updates work.
// Usage (from backend):  node scripts/socketTest.js <shop-slug> <access-token> [orderId]
// Another server:        $env:URL="https://your-server.onrender.com"; node scripts/socketTest.js ...
const { io } = require('socket.io-client');

const [slug, token, orderId] = process.argv.slice(2);
if (!slug || !token) {
    console.log('Usage: node scripts/socketTest.js <shop-slug> <access-token> [orderId]');
    process.exit(1);
}

const s = io(process.env.URL || 'http://localhost:5000', { auth: { token, tenant: slug } });
s.on('connect', () => {
    console.log('connected', s.id);
    if (orderId) s.emit('order:join', { orderId }, (r) => console.log('join order:', r));
});
s.on('connect_error', (e) => console.log('connect error:', e.message));
s.on('notification', (n) => console.log('notification:', n.title, '-', n.body));
s.on('order:update', (u) => console.log('order:update', u));
s.on('auth:expired', () => console.log('token expired'));
s.on('disconnect', (r) => console.log('disconnected:', r));