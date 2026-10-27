// Which waiter answers for a table's bill: the one who served them their food (the one who marked their latest dish Served). If that waiter is not
// on duty any more (or nobody is on record), every waiter on duty is asked instead, so a bill is never left with nobody.
const Order = require('../models/Order');
const duty = require('./staffDuty');

async function forTable(tenantId, sessionId) {
    const onDuty = await duty.peopleOnDuty(tenantId, 'waiter');
    const rows = await Order.find({ tenantId, tableSessionId: sessionId, status: 'delivered' }).sort({ deliveredAt: -1 }).limit(10).select('statusHistory').lean();
    for (const o of rows) {
        const h = [...(o.statusHistory || [])].reverse().find((x) => x.status === 'delivered' && x.by);
        if (!h) continue;
        const mine = onDuty.filter((p) => String(p.userId) === String(h.by));
        if (mine.length) return { people: mine, server: true };
        break;   // the one who served is not on duty: everyone on duty answers
    }
    return { people: onDuty, server: false };
}

module.exports = { forTable };
