// The platform's periodic job (every 10 minutes): finish "let the orders finish" shop closings, the plan reminders / end / grace / pause and the Partner wallet alerts
// (services/planLifecycle.js), and the SMS balance warnings. Everything is prepaid, so there are no bills to chase. Every message is claimed first, so two servers never repeat it.
const SmsWallet = require('../models/SmsWallet');
const Tenant = require('../models/Tenant');
const Notification = require('../models/Notification');
const wallet = require('./smsWalletService');
const notify = require('./notificationService');

const DAY_MS = 86400000;
const rsPaise = (p) => `Rs ${(p / 100).toFixed(2)}`;
const recentlySent = (tenantId, type, ms, now) => Notification.exists({ tenantId, role: 'owner', type, createdAt: { $gte: new Date(now.getTime() - ms) } });

async function smsBalances(now) {
    if (!wallet.shouldCharge()) return;   // mock SMS does not use the wallet
    // only wallets under Rs 1000 can be low; the exact check is done by wallet.status()
    const rows = await SmsWallet.find({ balancePaise: { $lt: 100000 } }).select('tenantId').lean();
    for (const w of rows) {
        const s = await wallet.status(w.tenantId);
        const type = s.zero ? 'sms_zero' : s.low ? 'sms_low' : null;
        if (!type) continue;
        if (await recentlySent(w.tenantId, type, DAY_MS, now)) continue;
        notify.toOwner(w.tenantId, type === 'sms_zero'
            ? { type, title: 'SMS balance is finished', data: { prompt: 'sms' }, body: s.blockAtZero ? 'Customers cannot log in until you top up.' : 'Please top up your SMS balance.' }
            : { type, title: 'SMS balance is low', data: { prompt: 'sms' }, body: `Your balance is ${rsPaise(s.balancePaise)}. Top up so customers can keep logging in.` });
    }
}

// shops closed by the superadmin: finish a closing once its last order is done
async function closureSweep(now) { await require('./shopClosure').sweep(now); }

// plan ending, ended, grace, pause; Partner wallet low and empty (services/planLifecycle.js)
async function planSweep(now) { await require('./planLifecycle').sweep(now); }

async function runAlerts(now = new Date()) {
    for (const step of [closureSweep, planSweep, smsBalances]) {
        try { await step(now); } catch (e) { console.error(`Platform job (${step.name}) error:`, e.message); }
    }
}

function startBillingAlertsScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await runAlerts(); } finally { running = false; }
    };
    setTimeout(run, 45 * 1000).unref?.();
    setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { runAlerts, startBillingAlertsScheduler };
