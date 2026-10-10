require('dotenv').config();   // keep this first: other files read process.env when they load
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const app = require('./app');
const realtime = require('../services/realtime');
const { startBillingScheduler } = require('../services/subscriptionService');
const { startOrderTimeoutScheduler } = require('../services/orderTimeout');
const { startBillingEnforcementScheduler } = require('../services/billingEnforcement');
const { startOfferScheduler } = require('../services/assignmentService');
const { startBillingAlertsScheduler } = require('../services/billingAlerts');
const { startStuckOrdersScheduler } = require('../services/stuckOrders');
const startAwakeCron = require('../jobs/awakeCrons');

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
            try { await mongoose.connection.close(); } catch (e) { /* ignore */ }
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
}

const PORT = process.env.PORT || 5000;

// Connect to the database FIRST, then start the server and the schedulers
connectDB()
    .then(() => {
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            registerShutdown(server);
            realtime.init(server);   // live updates (Socket.IO)
            startBillingScheduler();
            startOrderTimeoutScheduler();
            startBillingEnforcementScheduler();
            startOfferScheduler();
            startBillingAlertsScheduler();
            startStuckOrdersScheduler();

            // restricted to production to avoid local console spam
            if (process.env.NODE_ENV === 'production') startAwakeCron();
        });
    })
    .catch((err) => {
        console.error('Database connection failed:', err);
        process.exit(1);
    });