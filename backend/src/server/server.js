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
const { startOrderTimeoutScheduler } = require('../services/orderTimeout');

const app = express();

// Trust proxy for rate-limiting behind load balancers (Render, AWS, etc.)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '200kb' }));

// Whole-platform maintenance. /health and /api/admin are skipped inside the gate, so you can switch it off again.
app.use(platformGate);

// For your host's health check
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

const PORT = process.env.PORT || 5000;

// Connect to the database FIRST, then start the server (and the monthly rent-invoice scheduler)
connectDB()
    .then(() => {
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
        startBillingScheduler();
        startOrderTimeoutScheduler();
    })
    .catch((err) => {
        console.error('Database connection failed:', err);
        process.exit(1);
    });