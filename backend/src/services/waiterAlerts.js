// Tells the waiters when the floor changes: a live message to their screens, and a push to their phones when a dish is ready to serve or a
// table asks for something. Called from the one place where an order's status changes, and from the table calls. Never throws.
const Staff = require('../models/Staff');
const Tenant = require('../models/Tenant');
const realtime = require('./realtime');
const staffService = require('./staffService');
const pushChannel = require('../notifications/channels/push');
const { brief } = require('../utils/orderBrief');

const tell = (tenantId, p) => realtime.toWaiter(tenantId, 'waiter:update', p);

async function waiters(tenantId) {
    const tenant = await Tenant.findById(tenantId).select('settings.orders').lean();
    if (staffService.rulesOf(tenant).waiterOn !== true) return [];
    return Staff.find({ tenantId, role: 'waiter', isActive: true }).select('userId').lean();
}

async function ring(tenantId, { title, body, data, tag }) {
    const people = await waiters(tenantId);
    await Promise.all(people.map((p) => pushChannel.send({ tenantId, userId: p.userId, title, body, data, tag })
        .catch((e) => console.error('Waiter push error:', e.message))));
}

// a dine in order changed: the waiters' lists load again; a dish that is ready rings them
async function onStatus({ before, updated, status }) {
    try {
        if (updated.orderType !== 'dine_in') return;
        tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, table: updated.tableNo, status });
        if (status === 'ready' && before?.status !== 'ready') {
            await ring(updated.tenantId, {
                title: `Table ${updated.tableNo || ''}: ready to serve`.replace(/:\s*:/, ':'),
                body: `${brief(updated, 3)} · order #${updated.orderNo}`,
                data: { type: 'waiter_serve', orderId: String(updated._id), orderNo: updated.orderNo, table: updated.tableNo },
                tag: `serve:${updated._id}`,
            });
        }
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

// a guest asks for the waiter, water, cutlery, a clean table, or the bill
async function request(tenantId, { table, label, text, bill }) {
    try {
        tell(tenantId, { request: true, table });
        await ring(tenantId, {
            title: `Table ${table}`, body: `${label}${text ? `: ${text}` : ''}`,
            data: { type: bill ? 'waiter_bill' : 'waiter_call', table },
            tag: `req:${table}:${bill ? 'bill' : label}`,
        });
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

module.exports = { onStatus, request, tell };
