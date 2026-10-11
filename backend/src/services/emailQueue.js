// Puts a mail in the queue. It does not send anything (jobs/emailWorker.js does).
const EmailJob = require('../models/EmailJob');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));

// priority: 1 = most important (rent bills), 2 = normal, 3 = least (broadcasts)
async function enqueue({ tenantId, to, subject, html, text, attachments, priority = 2, kind }) {
    if (!isEmail(to)) return null;
    return EmailJob.create({
        tenantId, to,
        subject: String(subject).slice(0, 200),
        html, text,
        attachments: attachments?.length ? attachments : undefined,
        priority: Math.min(3, Math.max(1, priority)),
        kind,
    });
}

module.exports = { enqueue, isEmail };