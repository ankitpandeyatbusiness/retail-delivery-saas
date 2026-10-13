// Every night (03:00 Indian time): the SMS wallet balance of every shop must equal the sum of its ledger.
// A difference tells the superadmin, once a day per shop.
const SmsWallet = require('../models/SmsWallet');
const Tenant = require('../models/Tenant');
const Notification = require('../models/Notification');
const smsWallet = require('../services/smsWalletService');
const sentry = require('../utils/sentry');
const { startDailyJob } = require('../utils/dailyJob');

const TYPE = 'admin_wallet_mismatch';
const rs = (paise) => (paise / 100).toFixed(2);

async function alertOnce(row) {
    const since = new Date(Date.now() - 23 * 60 * 60 * 1000);
    if (await Notification.exists({ role: 'superadmin', type: TYPE, tenantId: row.tenantId, createdAt: { $gte: since } })) return false;
    const t = await Tenant.findById(row.tenantId).select('name').lean();
    await Notification.create({
        role: 'superadmin',
        type: TYPE,
        tenantId: row.tenantId,
        title: 'SMS wallet does not match its ledger',
        body: `${t ? t.name : 'A shop'}: balance Rs ${rs(row.balancePaise)}, ledger Rs ${rs(row.ledgerPaise)} (difference Rs ${rs(row.differencePaise)}). Check it before anything else changes.`,
    });
    return true;
}

async function runNightlyReconcile() {
    const wallets = await SmsWallet.find({}).select('tenantId').lean();
    const bad = [];
    for (const w of wallets) {
        const r = await smsWallet.reconcileWallet(w.tenantId);
        if (r.differencePaise !== 0) bad.push({ tenantId: w.tenantId, ...r });
    }
    let alerted = 0;
    for (const row of bad) {
        try {
            if (await alertOnce(row)) alerted += 1;
        } catch (e) {
            console.error('Reconcile alert failed:', e.message);
        }
        sentry.capture(new Error('SMS wallet mismatch'), { tenantId: String(row.tenantId), differencePaise: row.differencePaise });
    }
    return { checked: wallets.length, mismatched: bad.length, alerted };
}

function startNightlyReconcileScheduler() {
    startDailyJob({ name: 'nightly-reconcile', hour: 3, fn: runNightlyReconcile });
}

module.exports = { runNightlyReconcile, startNightlyReconcileScheduler };