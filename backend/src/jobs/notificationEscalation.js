// Every 30 seconds: a message that is still unread after its escalate time gets its SMS, once.
// (Owner "new order" = 180 seconds.) The SMS is claimed with a filtered update, so two servers never send it twice.
const Notification = require('../models/Notification');
const center = require('../notifications/center');

const BATCH = 50;

async function runEscalation(now = new Date()) {
    const due = await Notification.find({ escalateAt: { $lte: now }, smsSentAt: null, readAt: null })
        .sort({ escalateAt: 1 }).limit(BATCH).select('_id').lean();

    let sent = 0;
    for (const row of due) {
        const claimed = await Notification.findOneAndUpdate(
            { _id: row._id, escalateAt: { $lte: now }, smsSentAt: null, readAt: null },
            { $set: { smsSentAt: now } },
            { returnDocument: 'after' },
        ).lean();
        if (!claimed) continue;   // read, or another server took it
        try {
            const r = await center.escalate(claimed);
            if (r && r.sent) sent += 1;
        } catch (e) {
            console.error('Escalation error:', e.message);
        }
    }
    return sent;
}

function startNotificationEscalationScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await runEscalation();
            if (n) console.log(`Notifications: ${n} unread message(s) escalated to SMS`);
        } catch (e) {
            console.error('Escalation scheduler error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 20 * 1000).unref?.();
    setInterval(run, 30 * 1000).unref?.();
}

module.exports = { runEscalation, startNotificationEscalationScheduler };