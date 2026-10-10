// The Express app only. No database connection, no listen, no timers.
// server.js starts everything. Tests import this file directly.
const express = require('express');
const cors = require('cors');

const platformGate = require('../middlewares/platformGate');
const authRouter = require('../routes/authRouter');
const tenantRouter = require('../routes/tenantRouter');
const catalogRouter = require('../routes/catalogRouter');
const adminRouter = require('../routes/adminRouter');
const addressRouter = require('../routes/addressRouter');
const orderRouter = require('../routes/orderRouter');
const shopRouter = require('../routes/shopRouter');
const collectionRouter = require('../routes/collectionRouter');
const favouriteRouter = require('../routes/favouriteRouter');
const profileRouter = require('../routes/profileRouter');
const webhookRouter = require('../routes/webhookRouter');
const riderRouter = require('../routes/riderRouter');
const notificationRouter = require('../routes/notificationRouter');
const mongoose = require('mongoose');
const publicRateLimit = require('../middlewares/publicRateLimit');

const app = express();

// Trust proxy for rate-limiting behind load balancers (Render, AWS, etc.)
app.set('trust proxy', 1);

app.use(cors());

// Webhooks need the raw body, so they come BEFORE express.json and before platformGate
app.use('/api/webhooks', webhookRouter);

app.use(express.json({ limit: '200kb' }));

// Whole-platform maintenance. /health and /api/admin are skipped inside the gate, so you can switch it off again.
app.use(platformGate);

// For your host's health check (this is also the endpoint your cron job will hit)
app.get('/health', (req, res) => res.json({ ok: true }));

// Ready check: 200 only when the database really answers (your host can use this one)
app.get('/health/ready', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) return res.status(503).json({ ok: false });
        await mongoose.connection.db.admin().ping();
        return res.json({ ok: true });
    } catch (e) {
        return res.status(503).json({ ok: false });
    }
});

// 300 requests per minute per IP on public routes
app.use('/api/catalog', publicRateLimit);
app.use('/api/tenants', publicRateLimit);
app.use('/api/addresses/serviceability', publicRateLimit);

app.use('/api/auth', authRouter);
app.use('/api/tenants', tenantRouter);
app.use('/api/catalog/collections', collectionRouter);
app.use('/api/favourites', favouriteRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/admin', adminRouter);
app.use('/api/addresses', addressRouter);
app.use('/api/orders', orderRouter);
app.use('/api/shop', shopRouter);
app.use('/api/rider', riderRouter);
app.use('/api/notifications', notificationRouter.mine);
app.use('/api/me', profileRouter);

// Unknown URL
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Last-resort error handler: no stack traces or internals reach the client
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({ error: 'Something went wrong' });
});

module.exports = app;