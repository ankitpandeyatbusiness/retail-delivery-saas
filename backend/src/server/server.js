require('dotenv').config();   // keep this first: other files read process.env when they load
const sentry = require('../utils/sentry');
sentry.init();                // error reporting; does nothing without SENTRY_DSN
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
const { startHealthWatchScheduler } = require('../services/healthWatch');
const { startLateDeliveryScheduler } = require('../services/lateDelivery');
const startAwakeCron = require('../jobs/awakeCrons');
const { startComplaintRemindersScheduler } = require('../jobs/complaintReminders');
const { startNotificationEscalationScheduler } = require('../jobs/notificationEscalation');
const { startEmailWorkerScheduler } = require('../jobs/emailWorker');
const { startMonthlyReportsScheduler } = require('../jobs/monthlyReports');
const { startInactiveShopsScheduler } = require('../jobs/inactiveShops');
const { startAutopilotScheduler } = require('../jobs/autopilot');
const { startCleanupUploadsScheduler } = require('../jobs/cleanupUploads');
const { startBackupScheduler } = require('../jobs/backupDump');
const { startNightlyReconcileScheduler } = require('../jobs/nightlyReconcile');
const { startPaymentReconcileScheduler } = require('../services/paymentReconcile');
const { startRiderDutyScheduler } = require('../jobs/riderDuty');
const { startRiderScheduleTicker } = require('../services/riderSchedule');
const { startPickupReminders } = require('../jobs/pickupReminders');
const { startAutomations } = require('../jobs/automations');
const { startTableBillJob } = require('../services/tableBill');
const { startStaffNudges } = require('../jobs/staffNudges');
const { startBookingHolds } = require('../services/bookingPayment');
const { startKitchenQueue } = require('../jobs/kitchenQueue');
const { startBulkCookAlerts } = require('../jobs/bulkCookAlerts');
const { startBillReminders } = require('../jobs/billReminders');

// A crash is logged and the host restarts the server. A stray rejected promise is only logged.
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); sentry.capture(reason); });
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    sentry.capture(err);
    sentry.flush().finally(() => process.exit(1));
});

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
            startComplaintRemindersScheduler();
            startCleanupUploadsScheduler();
            startBackupScheduler();
            startNightlyReconcileScheduler();
            startOrderTimeoutScheduler();
            startBillingEnforcementScheduler();
            startOfferScheduler();
            startBillingAlertsScheduler();
            startStuckOrdersScheduler();
            require('../services/smsProviderBalance').startSmsBalanceScheduler();
            // every shop gets its short code and every old order, bulk order, booking, SMS top-up and table bill its quotable reference (only what is missing)
            require('../services/refs').backfillAll().then((r) => { if (Object.values(r).some(Boolean)) console.log('References filled in:', JSON.stringify(r)); }).catch((e) => console.error('References error:', e.message));
            require('../services/dailyDigest').startDailyDigestScheduler();
            startHealthWatchScheduler();
            startLateDeliveryScheduler();
            startNotificationEscalationScheduler();
            startEmailWorkerScheduler();
            startMonthlyReportsScheduler();
            startInactiveShopsScheduler();
            startAutopilotScheduler();
            startPaymentReconcileScheduler();
            require('../services/paymentAccounts').checkKeysReadable().catch((e) => console.error('Payment keys check error:', e.message));
            startRiderDutyScheduler();   // a rider who forgot to end duty is put off duty
            startRiderScheduleTicker();  // riders on "auto" go on and off duty by their own timing
            // the old "one open bill per table" index would refuse a second bill on a shared table: drop it once, make the new one
            require('../models/TableSession').collection.dropIndex('tenantId_1_table_1').catch(() => { }).then(() => require('../models/TableSession').createIndexes()).catch((e) => console.error('Table index error:', e.message));
            startTableBillJob();         // a visit nobody orders from and nothing is owed on is closed
            startBillReminders();        // a table that asked for the bill and was not served is reminded to the owner and the waiters every 5 minutes
            startKitchenQueue();         // an order the cook did not touch goes to his queue by itself
            startBulkCookAlerts();       // a bulk order is called to the cooks 24 hours before its day; an early packed delivery goes to riders 2 hours before
            startBookingHolds();         // an unpaid table booking is let go after its hold, and refunds that did not go out are tried again
            startStaffNudges();          // the cooks and the waiters get one nudge for an order that waits too long
            startAutomations();          // the owner's automations: pickups nobody collected, reservations nobody answered, quiet inquiries, reminders
            startPickupReminders();      // pickup orders that are ready: reminders to the customer, and the owner is told when nobody came
            setInterval(() => require('../services/loyaltyService').releaseDue().catch((e) => console.error('Points job error:', e.message)), 5 * 60 * 1000).unref?.();   // points whose 24 hours are over become spendable
            require('../services/platformTax').start();   // the one GST for all shops
            require('../services/platformPayments').start();   // my own Razorpay keys saved in the app

            // restricted to production to avoid local console spam
            if (process.env.NODE_ENV === 'production') startAwakeCron();
        });
    })
    .catch((err) => {
        console.error('Database connection failed:', err);
        process.exit(1);
    });