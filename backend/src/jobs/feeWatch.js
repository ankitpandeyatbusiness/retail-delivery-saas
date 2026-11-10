// Every night (04:00 Indian time): look for Partner shops whose orders dropped or are not completed (services/feeWatch.js).
const feeWatch = require('../services/feeWatch');
const sentry = require('../utils/sentry');
const { startDailyJob } = require('../utils/dailyJob');

async function runFeeWatch() {
    try { return await feeWatch.sweep(); } catch (e) { console.error('Fee watch error:', e.message); sentry.capture(e); return null; }
}

function startFeeWatchScheduler() {
    startDailyJob({ name: 'fee-watch', hour: 4, fn: runFeeWatch });
}

module.exports = { runFeeWatch, startFeeWatchScheduler };
