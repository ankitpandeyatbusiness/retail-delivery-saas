// Every morning (10:00 Indian time): remind the supreme admin of held plan payments and open bank disputes that still wait (services/planMoneyReminder.js).
const reminder = require('../services/planMoneyReminder');
const sentry = require('../utils/sentry');
const { startDailyJob } = require('../utils/dailyJob');

async function runPlanMoneyReminder() {
    try { return await reminder.remind(); } catch (e) { console.error('Plan money reminder error:', e.message); sentry.capture(e); return null; }
}

function startPlanMoneyReminderScheduler() {
    startDailyJob({ name: 'plan-money-reminder', hour: 10, fn: runPlanMoneyReminder });
}

module.exports = { runPlanMoneyReminder, startPlanMoneyReminderScheduler };
