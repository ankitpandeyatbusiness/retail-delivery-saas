// An inquiry nobody has answered for a day: the owner is reminded, once for each customer message (the super admin sets the delay: Services defaults).
// "Unanswered" = the customer wrote last and the owner has not opened or answered it. The inquiry is claimed first, so two runs never remind twice.
const ServiceInquiry = require('../models/ServiceInquiry');
const svc = require('./shopServices');

const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const OPEN = ['new', 'replied', 'quoted'];   // a confirmed, rejected or closed inquiry waits for nobody

async function sweep(now = Date.now()) {
    const hours = (await svc.loadDefaults()).reminderHours || svc.DEFAULT_REMINDER_HOURS;
    const cutoff = new Date(now - hours * 3600000);
    const due = await ServiceInquiry.find({
        status: { $in: OPEN }, ownerUnread: { $gt: 0 }, lastMessageAt: { $lte: cutoff },
        $expr: { $lt: [{ $ifNull: ['$unansweredNotifiedAt', new Date(0)] }, '$lastMessageAt'] },
    }).limit(100);
    let sent = 0;
    for (const i of due) {
        const claimed = await ServiceInquiry.findOneAndUpdate({ _id: i._id, ownerUnread: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ['$unansweredNotifiedAt', new Date(0)] }, '$lastMessageAt'] } }, { $set: { unansweredNotifiedAt: new Date(now) } });
        if (!claimed) continue;
        tell('inquiry_unanswered', { tenantId: i.tenantId, vars: { name: i.name, service: i.serviceName, hours }, data: { kind: 'inquiry', inquiryId: String(i._id) } });
        sent += 1;
    }
    return sent;
}

module.exports = { sweep };
