// A complaint with no reply for 24 hours: the owner gets ONE reminder. The claim is a filtered update,
// so two servers never remind twice.
const Complaint = require('../models/Complaint');
const center = require('../notifications/center');

async function runComplaintReminders(now = new Date()) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await Complaint.find({ status: 'open', remindedAt: null, createdAt: { $lte: cutoff } })
        .select('_id tenantId orderNo').limit(200).lean();
    let sent = 0;
    for (const r of rows) {
        const claimed = await Complaint.updateOne({ _id: r._id, status: 'open', remindedAt: null }, { $set: { remindedAt: now } });
        if (!claimed.modifiedCount) continue;
        sent += 1;
        center.notify('complaint_reminder', {
            tenantId: r.tenantId,
            title: 'Complaint waiting',
            body: `The complaint for order #${r.orderNo} has had no reply for 24 hours. Please answer it.`,
            data: { complaintId: String(r._id), orderNo: r.orderNo },
        });
    }
    return sent;
}

// The owner replied but did not decide, and 24 hours went by: the complaint moves to Decided with the reason written on it, whether or not the
// customer wrote back. The claim is a filtered update, so two servers never close it twice. The customer's money is not touched (no refund was decided).
async function closeAnswered(now = new Date()) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await Complaint.find({ status: 'in_progress', repliedAt: { $lte: cutoff } }).select('_id tenantId orderNo').limit(200).lean();
    let n = 0;
    for (const r of rows) {
        const done = await Complaint.updateOne({ _id: r._id, status: 'in_progress', repliedAt: { $lte: cutoff } }, { $set: {
            status: 'resolved', decidedAt: now, decidedBy: 'auto', autoReason: 'Closed by itself: 24 hours passed since the shop replied.',
        } });
        if (done.modifiedCount) n += 1;
    }
    return n;
}

function startComplaintRemindersScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await runComplaintReminders();
            if (n) console.log(`Complaint reminders: ${n} sent`);
            const closed = await closeAnswered();
            if (closed) console.log(`Complaints closed after 24 hours: ${closed}`);
        } catch (e) {
            console.error('Complaint reminders error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 90 * 1000).unref?.();
    setInterval(run, 30 * 60 * 1000).unref?.();
}

module.exports = { runComplaintReminders, closeAnswered, startComplaintRemindersScheduler };