// Tells the cooks when the kitchen's work changes: a live message to their screens, and a loud push to their phones when a new order
// arrives (so a phone in a pocket still rings). Called from the one place where an order's status changes. Never throws.
const Staff = require('../models/Staff');
const realtime = require('./realtime');
const staffService = require('./staffService');
const pushChannel = require('../notifications/channels/push');
const { NEW_ORDER_CHANNEL } = require('../notifications/events');
const { brief } = require('../utils/orderBrief');
const Tenant = require('../models/Tenant');

const TYPE_WORD = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
const IN_KITCHEN = ['accepted', 'preparing', 'ready'];

// the orders the kitchen screens should load again
const tell = (tenantId, p) => realtime.toKitchen(tenantId, 'kitchen:update', p);

async function cooks(tenantId) {
    return Staff.find({ tenantId, role: 'kitchen', isActive: true }).select('userId').lean();
}

async function onStatus({ before, updated, status }) {
    try {
        const touches = IN_KITCHEN.includes(status) || IN_KITCHEN.includes(before?.status);
        if (!touches) return;
        tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, status });

        const push = status === 'accepted' || (status === 'cancelled' && IN_KITCHEN.includes(before?.status));
        if (!push) return;
        const tenant = await Tenant.findById(updated.tenantId).select('settings.orders').lean();
        const rules = staffService.rulesOf(tenant);
        if (rules.kitchenOn !== true || !(rules.kitchenSees || []).includes(updated.orderType)) return;
        const people = await cooks(updated.tenantId);
        if (!people.length) return;

        const where = updated.orderType === 'dine_in' ? `Dine in${updated.tableNo ? ` · Table ${updated.tableNo}` : ''}` : TYPE_WORD[updated.orderType];
        const msg = status === 'accepted'
            ? { title: `New order #${updated.orderNo}`, body: [brief(updated, 3), where].filter(Boolean).join(' · '), loud: true }
            : { title: `Order #${updated.orderNo} cancelled`, body: 'Stop making it.', loud: false };
        await Promise.all(people.map((p) => pushChannel.send({
            tenantId: updated.tenantId, userId: p.userId, title: msg.title, body: msg.body,
            data: { type: status === 'accepted' ? 'kitchen_new' : 'kitchen_cancelled', orderId: String(updated._id), orderNo: updated.orderNo },
            ...(msg.loud ? { channelId: NEW_ORDER_CHANNEL, sound: 'new_order' } : {}),
            tag: `kitchen:${updated._id}`,
        }).catch((e) => console.error('Kitchen push error:', e.message))));
    } catch (e) {
        console.error('Kitchen alert error:', e.message);
    }
}

module.exports = { onStatus, tell };
