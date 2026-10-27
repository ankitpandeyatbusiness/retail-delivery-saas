// A table asked for the bill and nobody has come: after staff.billRemindMin minutes (3 unless the shop's settings say otherwise) the owner and the waiters are reminded, and again every that many minutes (at most 6 times).
// The bill closing (paid) ends it. Each reminder is claimed on the bill first, so two servers or two runs never send it twice.
const TableSession = require('../models/TableSession');
const Tenant = require('../models/Tenant');
const pushChannel = require('../notifications/channels/push');
const { STAFF_CHANNEL } = require('../notifications/events');

const MIN = 60000;
const EVERY_MS = 60 * 1000;
const GAP_MIN = 3;   // the shortest wait; the shop's own setting (staff.billRemindMin) decides, and is checked per bill below
const MAX_REMINDS = 6;

async function runBillReminders(now = new Date()) {
    const cut = new Date(now.getTime() - 60 * 1000);   // loose first cut (1 minute); each bill's own wait is checked in the loop
    const rows = await TableSession.find({
        status: 'bill_asked', kind: { $ne: 'pickup' }, billAskedAt: { $lte: cut }, billReminds: { $lt: MAX_REMINDS },
        $or: [{ billRemindedAt: { $exists: false } }, { billRemindedAt: { $lte: cut } }],
    }).select('tenantId table billAskedAt billRemindedAt billReminds').limit(100).lean();
    let sent = 0;
    for (const s of rows) {
        try {
            const tenant = await Tenant.findById(s.tenantId).select('settings.orders status').lean();
            if (!tenant || tenant.status === 'suspended') continue;
            const gap = (require('../services/staffService').rulesOf(tenant).billRemindMin || GAP_MIN) * MIN;
            if (now.getTime() - new Date(s.billAskedAt).getTime() < gap || (s.billRemindedAt && now.getTime() - new Date(s.billRemindedAt).getTime() < gap)) continue;
            const claimed = await TableSession.updateOne(
                { _id: s._id, status: 'bill_asked', billReminds: s.billReminds || 0 },
                { $set: { billRemindedAt: now }, $inc: { billReminds: 1 } },
            );
            if (claimed.modifiedCount !== 1) continue;
            const minutes = Math.round((now.getTime() - new Date(s.billAskedAt).getTime()) / MIN);
            require('../notifications/center').notify('table_bill_waiting', { tenantId: s.tenantId, vars: { table: s.table, minutes }, data: { kind: 'table', table: s.table, sessionId: String(s._id) } });
            if (tenant.settings?.orders?.staff?.waiterOn === true) {
                const { people } = await require('../services/tableWaiter').forTable(s.tenantId, s._id);   // the waiter who served them (everyone on duty if he is away)
                const speech = `Table ${s.table} is still waiting for the bill. They asked ${minutes} minutes ago.`;
                await Promise.all(people.map((p) => pushChannel.send({
                    tenantId: s.tenantId, userId: p.userId, title: `Table ${s.table} is still waiting for the bill`, body: `They asked ${minutes} minutes ago.`,
                    data: { type: 'waiter_bill', kind: 'bill', table: String(s.table), speech }, tag: `billwait:${s._id}`, channelId: STAFF_CHANNEL, sound: 'ting_tong',
                }).catch((e) => console.error('Bill reminder push error:', e.message))));
            }
            sent += 1;
        } catch (e) { console.error('Bill reminder error:', e.message); }
    }
    return sent;
}

function startBillReminders() {
    setInterval(() => runBillReminders().catch((e) => console.error('Bill reminders error:', e.message)), EVERY_MS).unref?.();
}

module.exports = { runBillReminders, startBillReminders };
