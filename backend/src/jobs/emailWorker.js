// Sends the queued mails. Every 30 seconds:
//   - never more than EMAIL_DAILY_LIMIT mails per day (Indian time), most important first
//   - a job is claimed with a filtered update (a 5 minute lease), so two servers never send the same mail
//   - a failed mail is tried again after 1 minute, then after 5 minutes, then it is marked failed (3 tries)
const EmailJob = require('../models/EmailJob');
const email = require('../services/adapters/email');

const IST_MS = 330 * 60000;
const LEASE_MS = 5 * 60000;
const MAX_TRIES = 3;
const PER_RUN = 50;

const dayStart = (now) => new Date(Math.floor((now.getTime() + IST_MS) / 86400000) * 86400000 - IST_MS);
const backoffMs = (tries) => (tries <= 1 ? 1 : 5) * 60000;
const dailyLimit = () => (Number(process.env.EMAIL_DAILY_LIMIT) > 0 ? Number(process.env.EMAIL_DAILY_LIMIT) : 300);

async function runEmailWorker({ now = new Date() } = {}) {
    if (!email.enabled()) return { sent: 0, failed: 0 };

    const sentToday = await EmailJob.countDocuments({ status: 'sent', sentAt: { $gte: dayStart(now) } });
    let room = Math.min(dailyLimit() - sentToday, PER_RUN);
    let guard = PER_RUN * 2;
    let sent = 0;
    let failed = 0;

    while (room > 0 && guard-- > 0) {
        const job = await EmailJob.findOneAndUpdate(
            { status: 'queued', sendAfter: { $lte: now } },
            { $inc: { tries: 1 }, $set: { sendAfter: new Date(now.getTime() + LEASE_MS) } },
            { sort: { priority: 1, sendAfter: 1, _id: 1 }, returnDocument: 'after' },
        );
        if (!job) break;
        try {
            const r = await email.send({
                to: job.to, subject: job.subject, html: job.html, text: job.text, attachments: job.attachments,
            });
            await EmailJob.updateOne(
                { _id: job._id },
                { $set: { status: 'sent', sentAt: now, messageId: r?.messageId }, $unset: { lastError: 1 } },
            );
            sent += 1;
            room -= 1;
        } catch (e) {
            const last = job.tries >= MAX_TRIES;
            await EmailJob.updateOne({ _id: job._id }, {
                $set: {
                    lastError: String(e.message).slice(0, 300),
                    ...(last ? { status: 'failed' } : { sendAfter: new Date(now.getTime() + backoffMs(job.tries)) }),
                },
            });
            failed += 1;
        }
    }
    return { sent, failed };
}

function startEmailWorkerScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runEmailWorker();
            if (r.sent || r.failed) console.log(`Email: ${r.sent} sent, ${r.failed} failed`);
        } catch (e) {
            console.error('Email worker error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 25 * 1000).unref?.();
    setInterval(run, 30 * 1000).unref?.();
}

module.exports = { runEmailWorker, startEmailWorkerScheduler };