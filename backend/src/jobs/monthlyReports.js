// The monthly progress report: on the first days of a month, every shop that had orders last month gets its report as an in-app
// message and push, and by email with a PDF (the email is the platform's own document, like the bill).
// Once per shop and month: the MonthlyReportLog row is claimed first, so two servers or a restart never send it twice.
// A shop can switch it off (settings.notifications.monthlyReport) and the superadmin can switch it off for all (insights.monthlyReportEmail).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const PlatformSettings = require('../models/PlatformSettings');
const center = require('../notifications/center');
const businessReport = require('../services/businessReport');

const IST_MS = 330 * 60000;
const SEND_FROM_HOUR = 9;      // not before 9 in the morning, India time
const SEND_UNTIL_DAY = 5;      // a missed day is caught up until the 5th

const logSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    period: { type: String, required: true },   // "2026-09": the month the report is about
    sentAt: { type: Date, default: Date.now },
    skipped: String,
}, { versionKey: false });
logSchema.index({ tenantId: 1, period: 1 }, { unique: true });
const Log = mongoose.models.MonthlyReportLog || mongoose.model('MonthlyReportLog', logSchema);

const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function lastMonth(now) {
    const ist = new Date(now.getTime() + IST_MS);
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function runMonthlyReports({ now = new Date(), force = false } = {}) {
    const ist = new Date(now.getTime() + IST_MS);
    if (!force && (ist.getUTCDate() > SEND_UNTIL_DAY || ist.getUTCHours() < SEND_FROM_HOUR)) return { sent: 0 };
    const platform = await PlatformSettings.findById('main').select('insights').lean();
    if (platform?.insights?.monthlyReportEmail === false) return { sent: 0, off: true };

    const period = lastMonth(now);
    const shops = await Tenant.find({ status: { $ne: 'suspended' } }).select('_id name settings.notifications').lean();
    let sent = 0;
    for (const shop of shops) {
        try {
            // claim the month first: whoever inserts the row sends the report
            try { await Log.create({ tenantId: shop._id, period }); } catch (e) { if (e.code === 11000) continue; throw e; }
            if (shop.settings?.notifications?.monthlyReport === false) { await Log.updateOne({ tenantId: shop._id, period }, { $set: { skipped: 'owner turned it off' } }); continue; }
            const report = await businessReport.build({ tenantId: shop._id, range: period, now });
            if (!report.totals.orders && !report.totals.placed) { await Log.updateOne({ tenantId: shop._id, period }, { $set: { skipped: 'no orders' } }); continue; }
            await center.notify('monthly_report', {
                tenantId: shop._id,
                title: `Your ${report.range.label} report is ready`,
                body: `${money(report.totals.revenue)} from ${report.totals.orders} orders${report.change.revenue !== null ? ` (${report.change.revenue >= 0 ? '+' : ''}${report.change.revenue}% vs the month before)` : ''}. Tap to see how your shop did.`,
                data: { kind: 'business_report', period },
                vars: { period },
            });
            sent += 1;
        } catch (e) {
            console.error(`Monthly report (${shop.name}) error:`, e.message);
            await Log.deleteOne({ tenantId: shop._id, period }).catch(() => { });   // try again on the next run
        }
    }
    return { sent, period };
}

function startMonthlyReportsScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runMonthlyReports();
            if (r.sent) console.log(`Monthly reports: ${r.sent} sent for ${r.period}`);
        } catch (e) {
            console.error('Monthly reports error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 3 * 60 * 1000).unref?.();
    setInterval(run, 60 * 60 * 1000).unref?.();   // hourly; the claim makes it once per shop and month
}

module.exports = { runMonthlyReports, startMonthlyReportsScheduler, lastMonth };
