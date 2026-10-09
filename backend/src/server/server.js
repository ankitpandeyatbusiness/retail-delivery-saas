require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Keep these paths exactly as in your current server file (it uses ../database, ../routes)
const connectDB = require('../database/database');
const platformGate = require('../middlewares/platformGate');
const { startBillingScheduler } = require('../services/subscriptionService');
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
const { startOrderTimeoutScheduler } = require('../services/orderTimeout');
const { startBillingEnforcementScheduler } = require('../services/billingEnforcement');
const { startOfferScheduler } = require('../services/assignmentService');
const { startBillingAlertsScheduler } = require('../services/billingAlerts');
const { startStuckOrdersScheduler } = require('../services/stuckOrders');
const riderRouter = require('../routes/riderRouter');
const notificationRouter = require('../routes/notificationRouter');
const realtime = require('../services/realtime');

// Import the awake cron job
const startAwakeCron = require('../jobs/awakeCrons');

const app = express();

// Trust proxy for rate-limiting behind load balancers (Render, AWS, etc.)
app.set('trust proxy', 1);

// Middleware
app.use(cors());

// Webhooks need the raw body, so they come BEFORE express.json and before platformGate
app.use('/api/webhooks', webhookRouter);

app.use(express.json({ limit: '200kb' }));

// Whole-platform maintenance. /health and /api/admin are skipped inside the gate, so you can switch it off again.
app.use(platformGate);

// For your host's health check (this is also the endpoint your cron job will hit)
app.get('/health', (req, res) => res.json({ ok: true }));

// Mount Routers
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

// A crash is logged and the host restarts the server. A stray rejected promise is only logged.
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); process.exit(1); });

// On deploy or stop, finish current requests and close the database before exit
function registerShutdown(server) {
    let closing = false;
    const stop = (signal) => {
        if (closing) return;
        closing = true;
        console.log(`${signal} received, shutting down`);
        setTimeout(() => process.exit(1), 10000).unref();   // force exit if sockets stay open
        server.close(async () => {
            try { await require('mongoose').connection.close(); } catch (e) { /* ignore */ }
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
}

const PORT = process.env.PORT || 5000;

// Connect to the database FIRST, then start the server (and the monthly rent-invoice scheduler)
connectDB()
    .then(() => {
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);

            // Start schedulers after server is listening
            registerShutdown(server);
            realtime.init(server);   // live updates (Socket.IO)
            startBillingScheduler();
            startOrderTimeoutScheduler();
            startBillingEnforcementScheduler();
            startOfferScheduler();
            startBillingAlertsScheduler();
            startStuckOrdersScheduler();

            // Start the awake cron (restricted to production to avoid local console spam)
            if (process.env.NODE_ENV === 'production') {
                startAwakeCron();
            }
        });
    })
    .catch((err) => {
        console.error('Database connection failed:', err);
        process.exit(1);
    });