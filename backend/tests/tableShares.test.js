require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const TableSession = require('../src/models/TableSession');
const TableRequest = require('../src/models/TableRequest');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');
const guestWatch = require('../src/services/guestWatch');

// One guest pays his share and leaves, or leaves without paying; and the owner is quietly told when a guest who owes cannot be reached.
let w; let n = 0; let slug;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `shares-${++n}`;
    w = await f.makeWorld(slug);
    await setDine({ enabled: true, tableCount: 10, sharedTables: true, maxParties: 3 });
});
afterEach(() => mock.restoreAll());

async function setDine(d) {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': d } });
    tenantRecognizer.invalidateTenant(slug);
}
const tenantDoc = () => Tenant.findById(w.tenant._id).lean();
const guest = (phone) => f.makeUser(w.tenant, 'customer', phone);
const api = (g, method, path, body) => request(app)[method](`/api/dinein${path}`).set(g.headers).send(body);
const owner = (method, path, body) => request(app)[method](`/api/shop${path}`).set(w.owner.headers).send(body);
const sit = (u, table = '4') => tableBill.joinOrOpen({ tenantId: w.tenant._id, table, userId: u.user._id });
const round = (g, s, total, o = {}) => f.makeOrder(w.tenant, g.user, { orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, status: 'delivered', pricing: { subtotal: total, total }, ...o });

// two friends on one bill: Asha ordered 300, Ravi 200
async function friends() {
    const a = await guest('9000000041'); const r = await guest('9000000042');
    const s = await sit(a);
    await TableSession.updateOne({ _id: s._id }, { $addToSet: { customers: r.user._id } });
    await round(a, s, 300); await round(r, s, 200);
    return { a, r, s };
}

describe('one guest pays his share and leaves, or leaves without paying', () => {
    test('the bill shows each person\'s share; "pay my share and leave" asks the waiter and the owner', async () => {
        const { a, r, s } = await friends();
        const bill = (await owner('get', `/dine-in/sessions/${s._id}`)).body;
        assert.deepEqual(bill.shares.map((x) => x.due).sort(), [200, 300]);
        const ask = await api(r, 'post', '/leave-ask', {});
        assert.equal(ask.status, 200, JSON.stringify(ask.body));
        assert.equal(ask.body.amount, 200);
        assert.equal((await api(r, 'post', '/leave-ask', {})).body.already, true, 'asking twice does not make a second request');
        assert.equal(await TableRequest.countDocuments({ tenantId: w.tenant._id, kind: 'share', status: 'open' }), 1);
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'table_share_ask' })) === 1);
        const reqs = (await owner('get', '/dine-in/requests')).body.items;
        assert.equal(reqs.find((x) => x.kind === 'share').userId, String(r.user._id));
        assert.equal((await api(a, 'post', '/leave-ask', {})).body.amount, 300);
    });

    test('the owner takes his share: his rounds are paid, he leaves the bill, the friend is told what is left', async () => {
        const { a, r, s } = await friends();
        await api(r, 'post', '/leave-ask', {});
        const done = await owner('post', `/dine-in/sessions/${s._id}/share/${r.user._id}/settle`, { method: 'cash' });
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(done.body.paidPaise, 20000);
        assert.equal(done.body.left, 300);
        assert.equal(done.body.closed, false);
        const fresh = await TableSession.findById(s._id);
        assert.deepEqual(fresh.customers.map(String), [String(a.user._id)]);
        assert.equal(fresh.left.length, 1);
        assert.equal(await Order.countDocuments({ tableSessionId: s._id, 'payment.status': 'paid' }), 1);
        assert.equal(await TableRequest.countDocuments({ kind: 'share', status: 'open' }), 0, 'the request is done');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: a.user._id, type: 'table_share_paid' })) === 1);
        assert.match((await Notification.findOne({ userId: a.user._id, type: 'table_share_paid' })).body, /₹300/);
        assert.equal(await tableBill.openFor(w.tenant._id, r.user._id), null, 'he is free to sit anywhere');
        const last = await owner('post', `/dine-in/sessions/${s._id}/share/${a.user._id}/settle`, { method: 'upi' });
        assert.equal(last.body.closed, true);
        assert.equal((await TableSession.findById(s._id)).status, 'closed');
    });

    test('a share cannot be taken while one of his dishes is still being made, or for someone who is not on the bill', async () => {
        const { a, r, s } = await friends();
        await round(r, s, 120, { status: 'preparing' });
        assert.equal((await owner('post', `/dine-in/sessions/${s._id}/share/${r.user._id}/settle`, { method: 'cash' })).status, 409);
        const stranger = await guest('9000000049');
        assert.equal((await owner('post', `/dine-in/sessions/${s._id}/share/${stranger.user._id}/settle`, { method: 'cash' })).status, 404);
        assert.equal((await owner('post', `/dine-in/sessions/${s._id}/share/${a.user._id}/settle`, { method: 'bitcoin' })).status, 400);
    });

    test('he left without paying: only his share becomes a bill he owes; the friend keeps hers and is told', async () => {
        const { a, r, s } = await friends();
        const out = await owner('post', `/dine-in/sessions/${s._id}/share/${r.user._id}/walkout`, {});
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body.owedPaise, 20000);
        assert.ok(await tableBill.owedBy(w.tenant._id, r.user._id), 'Ravi owes');
        assert.equal(await TableSession.countDocuments({ tenantId: w.tenant._id, walkout: true, customers: r.user._id }), 1);
        const open = await TableSession.findById(s._id);
        assert.deepEqual(open.customers.map(String), [String(a.user._id)]);
        assert.equal(open.status, 'open');
        assert.equal((await owner('get', `/dine-in/sessions/${s._id}`)).body.due, 300, 'her bill is only hers');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: a.user._id, type: 'table_share_left' })) === 1);
        assert.equal((await owner('post', `/dine-in/sessions/${s._id}/share/${r.user._id}/walkout`, {})).status, 404, 'he is no longer on this bill');
    });
});

describe('keeping an eye on a guest who owes (quietly)', () => {
    const ago = (m) => new Date(Date.now() - m * 60000);
    const owing = async () => {
        const a = await guest('9000000041');
        const s = await sit(a);
        await round(a, s, 250);
        return { a, s };
    };
    const count = () => Notification.countDocuments({ tenantId: w.tenant._id, type: 'table_guest_alert' });

    test('a phone not heard from for 10 minutes tells the owner once, quietly (in the list, no push); coming back clears it', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        const { a, s } = await owing();
        assert.equal((await api(a, 'post', '/presence', { loc: 'on' })).body.open, true);
        assert.equal(await guestWatch.scan(), 0, 'just heard from him: nothing');
        await TableSession.updateOne({ _id: s._id }, { $set: { [`presence.${a.user._id}.at`]: ago(15) } });
        assert.equal(await guestWatch.scan(), 1);
        assert.equal(await guestWatch.scan(), 0, 'not again for the same episode');
        await f.waitFor(async () => (await count()) === 1);
        const note = await Notification.findOne({ type: 'table_guest_alert' });
        assert.match(note.title, /phone is not reachable/);
        assert.match(note.body, /₹250/);
        assert.equal(spy.mock.calls.some((c) => c.arguments[0].data?.type === 'table_guest_alert'), false, 'no push, no sound');
        const row = (await tableBill.board(await tenantDoc())).find((t) => t.table === '4');
        assert.equal(row.watch[0].state, 'unreachable');
        assert.equal(row.watch[0].name, 'customer');
        await api(a, 'post', '/presence', { loc: 'on' });   // he is back
        await guestWatch.scan();
        assert.equal((await tableBill.board(await tenantDoc())).find((t) => t.table === '4').watch, undefined);
        await TableSession.updateOne({ _id: s._id }, { $set: { [`presence.${a.user._id}.at`]: ago(20) } });   // a second episode tells again
        await guestWatch.scan();
        await f.waitFor(async () => (await count()) === 2);
    });

    test('location switched off tells the owner; nothing is said when he owes nothing, when his app never reported, or when the owner switched it off', async () => {
        const { a, s } = await owing();
        await api(a, 'post', '/presence', { loc: 'off' });
        assert.equal(await guestWatch.scan(), 1);
        await f.waitFor(async () => (await count()) === 1);
        assert.match((await Notification.findOne({ type: 'table_guest_alert' })).title, /location is off/);

        await Order.updateMany({ tableSessionId: s._id }, { $set: { 'payment.status': 'paid' } });   // he has paid: no reason to watch
        await TableSession.updateOne({ _id: s._id }, { $unset: { watch: 1 } });
        assert.equal(await guestWatch.scan(), 0);

        await Order.updateMany({ tableSessionId: s._id }, { $set: { 'payment.status': 'pending' } });
        await TableSession.updateOne({ _id: s._id }, { $unset: { presence: 1 } });   // an older app that never reported
        assert.equal(await guestWatch.scan(), 0);

        await api(a, 'post', '/presence', { loc: 'off' });
        await setDine({ enabled: true, tableCount: 10, sharedTables: true, maxParties: 3, guestWatch: false });
        assert.equal(await guestWatch.scan(), 0, 'switched off by the owner');
        assert.equal((await tableBill.board(await tenantDoc())).find((t) => t.table === '4').watch, undefined);
    });

    test('the owner can set the switch and the minutes; bad minutes are refused', async () => {
        const ok = await owner('put', '/settings', { orders: { dineIn: { guestWatch: true, unreachableMin: 15 } } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await tenantDoc()).settings.orders.dineIn.unreachableMin, 15);
        assert.equal((await owner('put', '/settings', { orders: { dineIn: { unreachableMin: 2 } } })).status, 400);
        assert.equal((await owner('put', '/settings', { orders: { dineIn: { unreachableMin: 90 } } })).status, 400);
    });
});
