// Tells the waiters when the floor changes: a live message to their screens, and a push to their phones when a dish is ready to serve or a
// table asks for something. Called from the one place where an order's status changes, and from the table calls. Never throws.
const Staff = require('../models/Staff');
const Tenant = require('../models/Tenant');
const realtime = require('./realtime');
const staffService = require('./staffService');
const pushChannel = require('../notifications/channels/push');
const { brief } = require('../utils/orderBrief');
const { STAFF_CHANNEL, CANCEL_CHANNEL } = require('../notifications/events');

const tell = (tenantId, p) => realtime.toWaiter(tenantId, 'waiter:update', p);

async function waiters(tenantId) {
    const tenant = await Tenant.findById(tenantId).select('settings.orders').lean();
    if (staffService.rulesOf(tenant).waiterOn !== true) return [];
    return require('./staffDuty').peopleOnDuty(tenantId, 'waiter');   // only the waiters on duty are told (nobody while the shop is closed)
}

async function ring(tenantId, { title, body, data, tag, alarm }) {
    const people = await waiters(tenantId);
    await Promise.all(people.map((p) => pushChannel.send({ tenantId, userId: p.userId, title, body, data, tag, channelId: alarm ? CANCEL_CHANNEL : STAFF_CHANNEL, sound: alarm ? 'cancel_alert' : 'ting_tong' })
        .catch((e) => console.error('Waiter push error:', e.message))));
}

// a dine in order changed: the waiters' lists load again; a dish that is ready rings them
async function onStatus({ before, updated, status }) {
    try {
        if (updated.orderType !== 'dine_in') return;
        tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, table: updated.tableNo, status });
        // a cancelled order is the cook's news, not the waiter's: no alert and no push for it (the floor list just loads again, above)
        if (status === 'ready' && before?.status !== 'ready') {
            tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, table: updated.tableNo, status, alert: { kind: 'ready', table: updated.tableNo, orderNo: updated.orderNo } });
            await ring(updated.tenantId, {
                title: `Table ${updated.tableNo || ''}${updated.tableParty ? ` · ${updated.tableParty}` : ''}: ready to serve`.replace(/:\s*:/, ':'),
                body: `${brief(updated, 3)} · order #${updated.orderNo}`,
                data: { type: 'waiter_serve', orderId: String(updated._id), orderNo: updated.orderNo, table: String(updated.tableNo || ''), kind: 'ready', speech: `Table ${updated.tableNo}, food is ready`, speechHi: `टेबल ${updated.tableNo}, खाना तैयार है` },
                tag: `serve:${updated._id}`,
            });
        }
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

// a guest asks for the waiter, water, cutlery, a clean table, or the bill
async function request(tenantId, { table, label, text, bill, party }) {
    try {
        tell(tenantId, { request: true, table, alert: { kind: bill ? 'bill' : 'call', table } });
        await ring(tenantId, {
            title: `Table ${table}${party ? ` · ${party}` : ''}`, body: `${label}${text ? `: ${text}` : ''}`,
            data: { type: bill ? 'waiter_bill' : 'waiter_call', table: String(table), kind: bill ? 'bill' : 'call', speech: bill ? `Table ${table} wants the bill` : `Table ${table} is calling`, speechHi: bill ? `टेबल ${table} को बिल चाहिए` : `टेबल ${table} बुला रही है` },
            tag: `req:${table}:${bill ? 'bill' : label}`,
        });
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

module.exports = { onStatus, request, tell };
