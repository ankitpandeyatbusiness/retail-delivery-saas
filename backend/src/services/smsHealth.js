// 3 failed SMS in 10 minutes = the SMS provider is failing. The superadmin is told ONCE per 30 minutes.
// The right to alert is claimed in ONE atomic update, so parallel failures send ONE alert.
const SmsLog = require('../models/SmsLog');
const PlatformSettings = require('../models/PlatformSettings');
const adminAlerts = require('./adminAlerts');

const WINDOW_MS = 10 * 60000;
const QUIET_MS = 30 * 60000;
const LIMIT = 3;

async function check(now = new Date()) {
    const failed = await SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: new Date(now.getTime() - WINDOW_MS) } });
    if (failed < LIMIT) return null;
    try {
        const r = await PlatformSettings.updateOne(
            {
                _id: 'main',
                $or: [
                    { 'alerts.lastSmsFailAt': { $exists: false } },
                    { 'alerts.lastSmsFailAt': { $lte: new Date(now.getTime() - QUIET_MS) } },
                ],
            },
            { $set: { 'alerts.lastSmsFailAt': now } },
            { upsert: true, setDefaultsOnInsert: true },
        );
        if (!r.modifiedCount && !r.upsertedCount) return null;
    } catch (e) {
        if (e.code === 11000) return null;   // someone else claimed it a moment ago
        throw e;
    }
    return adminAlerts.alert('admin_sms_provider_failing', { vars: { detail: `${failed} SMS failed in the last 10 minutes` } });
}

module.exports = { check };