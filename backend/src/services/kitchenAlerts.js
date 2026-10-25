// Tells the cooks when the kitchen's work changes: a live message to their screens, and a loud push to their phones when a new order
// arrives (so a phone in a pocket still rings). Called from the one place where an order's status changes. Never throws.
const Staff = require('../models/Staff');
const realtime = require('./realtime');
const staffService = require('./staffService');
const pushChannel = require('../notifications/channels/push');
const { STAFF_CHANNEL, STAFF_INFO_CHANNEL, CANCEL_CHANNEL } = require('../notifications/events');
const { brief } = require('../utils/orderBrief');
const { kitchenSpeech, kitchenCancelSpeech } = require('../utils/orderSpeech');
const Tenant = require('../models/Tenant');

const TYPE_WORD = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
const IN_KITCHEN = ['accepted', 'preparing', 'ready'];

// the orders the kitchen screens should load again
const tell = (tenantId, p) => realtime.toKitchen(tenantId, 'kitchen:update', p);

async function cooks(tenantId) {
    return require('./staffDuty').peopleOnDuty(tenantId, 'kitchen');   // only the cooks on duty are told (nobody while the shop is closed)
}

// the order left the kitchen: handed to the customer, collected by the rider, or served at the table. A cook who switched this off is not told.
async function leftKitchen({ before, updated, status }) {
    const tenant = await Tenant.findById(updated.tenantId).select('settings.orders').lean();
    const rules = staffService.rulesOf(tenant);
    if (rules.kitchenOn !== true || !(rules.kitchenSees || []).includes(updated.orderType)) return;
    if (updated.orderType === 'dine_in') { tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, status }); return; }   // the cook's job ends when food leaves the kitchen: a table's "served" is for the waiter
    const word = updated.orderType === 'delivery'
        ? { title: `Order #${updated.orderNo} collected`, body: 'The delivery partner has it.' }
        : updated.orderType === 'pickup'
            ? { title: `Order #${updated.orderNo} handed over`, body: 'The customer has it.' }
            : { title: `Order #${updated.orderNo} served`, body: updated.tableNo ? `Table ${updated.tableNo} has it.` : 'It is at the table.' };
    tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, status, alert: { kind: 'done', orderNo: updated.orderNo, speech: word.title, speechHi: `ऑर्डर ${updated.orderNo} ले लिया गया` } });
    const people = (await cooks(updated.tenantId)).filter((p) => p.prefs?.tellDone !== false);
    await Promise.all(people.map((p) => pushChannel.send({
        tenantId: updated.tenantId, userId: p.userId, ...word,
        data: { type: 'kitchen_done', orderId: String(updated._id), orderNo: updated.orderNo, speech: word.title, speechHi: `ऑर्डर ${updated.orderNo} ले लिया गया` }, tag: `done:${updated._id}`, channelId: STAFF_INFO_CHANNEL, sound: 'notify',
    }).catch((e) => console.error('Kitchen push error:', e.message))));
}

async function onStatus({ before, updated, status }) {
    require('./waiterAlerts').onStatus({ before, updated, status }).catch((e) => console.error('Waiter alert error:', e.message));
    try {
        if ((status === 'delivered' || status === 'out_for_delivery') && IN_KITCHEN.includes(before?.status)) { await leftKitchen({ before, updated, status }); return; }
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
        const said = status === 'accepted' ? { speech: kitchenSpeech(updated), speechHi: kitchenSpeech(updated, true) } : { speech: kitchenCancelSpeech(updated), speechHi: kitchenCancelSpeech(updated, true) };
        tell(updated.tenantId, { orderId: String(updated._id), orderNo: updated.orderNo, status, alert: { kind: status === 'accepted' ? 'new' : 'cancel', orderNo: updated.orderNo, orderId: String(updated._id), table: updated.tableNo || null, ...said } });   // the open screens ring (sound and voice)

        const where = updated.orderType === 'dine_in' ? `Dine in${updated.tableNo ? ` · Table ${updated.tableNo}${updated.tableParty ? ` · ${updated.tableParty}` : ''}` : ''}` : TYPE_WORD[updated.orderType];
        const msg = status === 'accepted'
            ? { title: `New order #${updated.orderNo}`, body: [brief(updated, 3), where].filter(Boolean).join(' · '), loud: true }
            : { title: `Order #${updated.orderNo} cancelled`, body: 'Stop making it.', loud: false };
        await Promise.all(people.map((p) => pushChannel.send({
            tenantId: updated.tenantId, userId: p.userId, title: msg.title, body: msg.body,
            data: {
                type: status === 'accepted' ? 'kitchen_new' : 'kitchen_cancelled', orderId: String(updated._id), orderNo: updated.orderNo,
                kind: status === 'accepted' ? 'new' : 'cancel',
                speech: said.speech, speechHi: said.speechHi,
            },
            channelId: status === 'accepted' ? STAFF_CHANNEL : CANCEL_CHANNEL, sound: status === 'accepted' ? 'ting_tong' : 'cancel_alert',   // a cancelled order has its own alarm
            tag: `kitchen:${updated._id}`,
        }).catch((e) => console.error('Kitchen push error:', e.message))));
    } catch (e) {
        console.error('Kitchen alert error:', e.message);
    }
}

// a guest at a table pressed "please hurry": the cooks see it on their screen and on their phone
async function hurry(tenantId, { table, minutes, what }) {
    try {
        tell(tenantId, { hurry: true, table, alert: { kind: 'hurry', table } });
        const tenant = await Tenant.findById(tenantId).select('settings.orders').lean();
        if (staffService.rulesOf(tenant).kitchenOn !== true) return;
        const people = await cooks(tenantId);
        await Promise.all(people.map((p) => pushChannel.send({
            tenantId, userId: p.userId, title: `Table ${table} is waiting`, body: `${what || 'Their order'} · ${minutes} min. Please hurry.`,
            data: { type: 'kitchen_hurry', table: String(table), kind: 'hurry', speech: `Table ${table} is asking you to please make the food fast. They are hungry!`, speechHi: `टेबल ${table} जल्दी खाना बनाने को कह रही है। उन्हें भूख लगी है!` }, tag: `hurry:${table}`, channelId: STAFF_CHANNEL, sound: 'ting_tong',
        }).catch((e) => console.error('Kitchen push error:', e.message))));
    } catch (e) { console.error('Kitchen alert error:', e.message); }
}

module.exports = { onStatus, tell, hurry };
