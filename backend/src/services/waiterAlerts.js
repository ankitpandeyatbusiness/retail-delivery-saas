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

async function ring(tenantId, { title, body, data, tag, alarm, only }) {
    const people = (await waiters(tenantId)).filter((p) => !only?.length || only.includes(String(p.userId)));   // `only`: just these waiters (the one who served the table)
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

// what a guest asked for, said the way the waiter hears it: "Table 5, Anil asked for water"
const ASKED = { waiter: 'called the waiter', water: 'asked for water', cutlery: 'asked for a spoon, plate or tissue', clean: 'asked you to clean the table', other: 'needs help', share: 'wants to pay and leave' };
const ASKED_HI = { waiter: 'ने वेटर को बुलाया', water: 'ने पानी मांगा', cutlery: 'ने चम्मच, प्लेट या टिशू मांगा', clean: 'ने टेबल साफ़ करने को कहा', other: 'को मदद चाहिए', share: 'अपना हिस्सा देकर जाना चाहते हैं' };
function askedLine(table, what, name, party) {
    const who = name || 'A guest';
    const bill = party ? `, bill ${party}` : '';
    return { en: `Table ${table}${bill}, ${who} ${ASKED[what]}`, hi: `टेबल ${table}${party ? `, बिल ${party}` : ''}, ${name || 'एक मेहमान'} ${ASKED_HI[what]}` };
}

// a guest asks for the waiter, water, cutlery, a clean table, or the bill. `what` is the kind of call and `name` the guest's first name
// (nothing when he gave none): the screen, the push and the voice all say who asked for what.
async function request(tenantId, { table, label, text, bill, party, what, name, again, only }) {
    try {
        const line = !bill && ASKED[what] ? askedLine(table, what, name, party) : null;
        const speech = bill ? `Table ${table} is asking for the bill` : line ? line.en : `Table ${table} is calling you`;
        const speechHi = bill ? `टेबल ${table} बिल मांग रही है` : line ? line.hi : `टेबल ${table} आपको बुला रही है`;
        tell(tenantId, { request: true, table, alert: { kind: bill ? 'bill' : 'call', table, what: what || null, name: name || null, speech, speechHi, ...(only?.length ? { only } : {}), ...(again ? { nonce: Date.now() } : {}) } });
        await ring(tenantId, {
            title: `Table ${table}${party ? ` · ${party}` : ''}`, body: line ? `${name || 'A guest'} ${ASKED[what]}${text ? `: ${text}` : ''}` : `${label}${text ? `: ${text}` : ''}`,
            data: { type: bill ? 'waiter_bill' : 'waiter_call', table: String(table), kind: bill ? 'bill' : 'call', speech, speechHi },
            tag: `req:${table}:${bill ? 'bill' : what || label}${again ? `:${Date.now()}` : ''}`, only,   // a reminder is a new alert, not the old one again
        });
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

// a guest paid his bill online: the waiters hear it (screen and phone), so nobody walks over with a machine
async function paidOnline(tenantId, { table, amount, name }) {
    const who = name && name !== 'A guest' ? `${name} paid` : 'Paid';
    try {
        tell(tenantId, { request: true, table, paid: true, alert: { kind: 'paid', table, amount, name: name || null } });
        await ring(tenantId, {
            title: `Table ${table}: ${who} online`, body: `₹${Math.round(amount)} was paid from the guest's phone.`,
            data: { type: 'waiter_paid', table: String(table), kind: 'paid', speech: `${name || `Table ${table}`} paid ${Math.round(amount)} rupees online${name ? ` for table ${table}` : ''}`, speechHi: `टेबल ${table} ने ${Math.round(amount)} रुपये ऑनलाइन दे दिए` },
            tag: `paid:${table}`,
        });
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

// half an hour before a booked table: the waiters on duty hear which table, for how many, and for whom
async function bookingSoon(tenantId, { table, party, time, name }) {
    try {
        const who = name ? ' ' + name + '.' : '';
        const t = table ? 'Table ' + table : 'A table';
        await ring(tenantId, {
            title: t + ' is booked at ' + time, body: party + (party === 1 ? ' guest.' : ' guests.') + who,
            data: { type: 'waiter_booking', table: String(table || ''), kind: 'booking', speech: t + ' is booked for ' + party + ' guests at ' + time + '.' + who, speechHi: (table ? 'टेबल ' + table : 'एक टेबल') + ', ' + party + ' मेहमान, ' + time + ' बजे के लिए बुक है।' + who },
            tag: 'booked:' + table + ':' + time,
        });
    } catch (e) { console.error('Waiter alert error:', e.message); }
}

module.exports = { onStatus, request, tell, paidOnline, bookingSoon };
