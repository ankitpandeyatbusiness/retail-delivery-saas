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
const TableSession = require('../src/models/TableSession');
const TableJoin = require('../src/models/TableJoin');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');
const shared = require('../src/services/sharedTables');

// Shared tables: several separate bills on one table, chosen by the guests themselves.
let w; let n = 0; let slug;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `shared-${++n}`;
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
const sit = (u, table = '4') => tableBill.joinOrOpen({ tenantId: w.tenant._id, table, userId: u.user._id });

describe('choosing a bill at a shared table', () => {
    test('the first guest gets bill A; a second guest at the same table must choose before he can order', async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042');
        const sa = await sit(a);
        assert.equal(sa.label, 'A');
        await assert.rejects(() => sit(b), (e) => e.status === 409 && e.extra?.code === 'choose_party');
        const info = await tableBill.placementInfo({ tenant: await tenantDoc(), userId: b.user._id, table: '4' });
        assert.equal(info.choose.parties.length, 1);
        assert.equal(info.choose.canSeparate, true);
        const mineInfo = await tableBill.placementInfo({ tenant: await tenantDoc(), userId: a.user._id, table: '4' });
        assert.equal(mineInfo.choose, null, 'the first guest orders as usual');
    });

    test('"separate" gives the next letter at once, his own session and his own bill; the table is full at the limit', async () => {
        const [a, b, c, d] = [await guest('9000000041'), await guest('9000000042'), await guest('9000000043'), await guest('9000000044')];
        await sit(a);
        const rb = await api(b, 'post', '/table/4/enter', { choice: 'separate' });
        assert.equal(rb.status, 200, JSON.stringify(rb.body));
        assert.equal(rb.body.session.label, 'B');
        const sb = await sit(b);
        assert.equal(String(sb._id), rb.body.session.sessionId);
        assert.equal((await api(c, 'post', '/table/4/enter', { choice: 'separate' })).body.session.label, 'C');
        const full = await api(d, 'post', '/table/4/enter', { choice: 'separate' });
        assert.equal(full.status, 409);
        assert.equal(full.body.code, 'table_full');
        assert.equal(await TableSession.countDocuments({ tenantId: w.tenant._id, table: '4', status: 'open' }), 3);
        // entering again returns the same bill, never a second one
        assert.equal((await api(b, 'post', '/table/4/enter', { choice: 'separate' })).body.session.label, 'B');
        assert.equal(await TableSession.countDocuments({ tenantId: w.tenant._id, table: '4', customers: b.user._id }), 1);
    });

    test('the table state tells the app who is there (first names only) and what he can do', async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042');
        await sit(a);
        const st = (await api(b, 'get', '/table/4')).body;
        assert.equal(st.shared, true);
        assert.equal(st.occupied, true);
        assert.equal(st.canSeparate, true);
        assert.equal(st.max, 3);
        assert.equal(st.parties[0].label, 'A');
        assert.equal(st.parties[0].mine, false);
        assert.ok(!JSON.stringify(st).includes('9000000041'), 'no phone numbers');
        assert.equal((await api(a, 'get', '/table/4')).body.parties[0].mine, true);
        assert.equal((await api(b, 'get', '/table/5')).body.occupied, false);
    });
});

describe('"I am with them"', () => {
    test('the person at the table says yes: he is on that bill; the newcomer is told; he cannot be on two bills', async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042');
        const sa = await sit(a);
        const asked = await api(b, 'post', '/table/4/enter', { choice: 'with', sessionId: String(sa._id) });
        assert.equal(asked.status, 200, JSON.stringify(asked.body));
        const joinId = asked.body.pending.joinId;
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: a.user._id, type: 'table_join_request' })) === 1);

        const waiting = (await api(a, 'get', '/joins')).body.items;
        assert.equal(waiting.length, 1);
        assert.equal(waiting[0].who, 'customer');
        assert.equal((await api(b, 'get', `/join/${joinId}`)).body.status, 'pending');
        assert.equal((await api(b, 'post', `/join/${joinId}/answer`, { approve: true })).status, 403, 'only someone on the bill may answer');

        assert.equal((await api(a, 'post', `/join/${joinId}/answer`, { approve: true })).status, 200);
        const st = (await api(b, 'get', `/join/${joinId}`)).body;
        assert.equal(st.status, 'approved');
        assert.equal(st.session.label, 'A');
        assert.equal((await TableSession.findById(sa._id)).customers.length, 2);
        const again = await sit(b);   // his order goes on bill A
        assert.equal(String(again._id), String(sa._id));
        assert.equal((await api(a, 'post', `/join/${joinId}/answer`, { approve: false })).status, 409, 'answered once');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: b.user._id, type: 'table_join_answer' })) === 1);
    });

    test('a "no" leaves him free to take his own bill; a request nobody answers runs out after 2 minutes', async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042'); const c = await guest('9000000043');
        const sa = await sit(a);
        const j1 = (await api(b, 'post', '/table/4/enter', { choice: 'with', sessionId: String(sa._id) })).body.pending.joinId;
        await api(a, 'post', `/join/${j1}/answer`, { approve: false });
        assert.equal((await api(b, 'get', `/join/${j1}`)).body.status, 'denied');
        assert.equal((await api(b, 'post', '/table/4/enter', { choice: 'separate' })).body.session.label, 'B');

        const j2 = (await api(c, 'post', '/table/4/enter', { choice: 'with', sessionId: String(sa._id) })).body.pending.joinId;
        await TableJoin.updateOne({ _id: j2 }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        assert.equal((await api(c, 'get', `/join/${j2}`)).body.status, 'expired');
        assert.equal((await api(a, 'post', `/join/${j2}/answer`, { approve: true })).status, 409, 'too late');
        assert.equal((await api(c, 'post', '/table/4/enter', { choice: 'separate' })).body.session.label, 'C');
    });
});

describe('the board and the switch', () => {
    test('a table with several bills lists them; it is free only when every bill is closed', async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042');
        const sa = await sit(a);
        await api(b, 'post', '/table/4/enter', { choice: 'separate' });
        const sb = await sit(b);
        const row = (await tableBill.board(await tenantDoc())).find((t) => t.table === '4');
        assert.equal(row.state, 'eating');
        assert.equal(row.parties.length, 2);
        assert.deepEqual(row.parties.map((p) => p.label), ['A', 'B']);
        await TableSession.updateOne({ _id: sb._id }, { $set: { status: 'bill_asked' } });
        assert.equal((await tableBill.board(await tenantDoc())).find((t) => t.table === '4').state, 'bill_asked');
        await TableSession.updateMany({ _id: { $in: [sa._id, sb._id] } }, { $set: { status: 'closed' } });
        assert.equal((await tableBill.board(await tenantDoc())).find((t) => t.table === '4').state, 'free');
    });

    test('with the switch OFF a table has one bill, but a stranger is never added silently: the person seated must say yes', async () => {
        await setDine({ enabled: true, tableCount: 10, sharedTables: false });
        const a = await guest('9000000041'); const b = await guest('9000000042');
        const sa = await sit(a);
        await assert.rejects(() => sit(b), (e) => e.status === 409 && e.extra?.code === 'choose_party', 'he is asked first');
        const st = (await api(b, 'get', '/table/4')).body;
        assert.equal(st.shared, false);
        assert.equal(st.canSeparate, false, 'no second bill when the shop has one bill per table');
        assert.equal((await api(b, 'post', '/table/4/enter', { choice: 'separate' })).status, 400);
        const asked = await api(b, 'post', '/table/4/enter', { choice: 'with', sessionId: String(sa._id) });
        assert.equal(asked.status, 200, JSON.stringify(asked.body));
        assert.ok(asked.body.pending.joinId);
        assert.equal((await api(a, 'post', `/join/${asked.body.pending.joinId}/answer`, { approve: true })).status, 200);
        assert.equal(String((await sit(b))._id), String(sa._id), 'once let in he is on the same bill');
        assert.equal((await TableSession.findById(sa._id)).customers.length, 2);
    });

    test('the owner can set the switch and the limit; bad limits are refused', async () => {
        const ok = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ orders: { dineIn: { sharedTables: true, maxParties: 5 } } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await tenantDoc()).settings.orders.dineIn.maxParties, 5);
        assert.equal((await request(app).put('/api/shop/settings').set(w.owner.headers).send({ orders: { dineIn: { maxParties: 1 } } })).status, 400);
        assert.equal((await request(app).put('/api/shop/settings').set(w.owner.headers).send({ orders: { dineIn: { maxParties: 9 } } })).status, 400);
    });
});

describe('the owner puts things right', () => {
    const Order = require('../src/models/Order');
    const TableRequest = require('../src/models/TableRequest');
    const owner = (method, path, body) => request(app)[method](`/api/shop${path}`).set(w.owner.headers).send(body);
    const round = (g, s, o = {}) => f.makeOrder(w.tenant, g.user, { orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, tableParty: s.label, status: 'accepted', pricing: { subtotal: 100, total: 100 }, ...o });
    const twoBills = async () => {
        const a = await guest('9000000041'); const b = await guest('9000000042');
        const sa = await sit(a);
        await api(b, 'post', '/table/4/enter', { choice: 'separate' });
        const sb = await sit(b);
        return { a, b, sa, sb };
    };

    test('a round on the wrong bill is moved to the other bill of the same table; the empty bill closes itself', async () => {
        const { b, sa, sb } = await twoBills();
        const o = await round(b, sb);
        const bill = (await owner('get', `/dine-in/sessions/${sa._id}`)).body;
        assert.equal(bill.siblings.length, 1);
        assert.equal(bill.siblings[0].label, 'B');
        const r = await owner('post', `/dine-in/orders/${o._id}/move`, { toSessionId: String(sa._id) });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const fresh = await Order.findById(o._id);
        assert.equal(String(fresh.tableSessionId), String(sa._id));
        assert.equal(fresh.tableParty, 'A');
        assert.equal((await TableSession.findById(sb._id)).status, 'closed', 'bill B had nothing left');
        assert.equal((await TableSession.findById(sa._id)).customers.length, 2);
        assert.equal((await owner('post', `/dine-in/orders/${o._id}/move`, { toSessionId: String(sa._id) })).status, 400, 'already there');
    });

    test('rounds cannot move to a bill of another table or from a cancelled round', async () => {
        const { a, b, sa, sb } = await twoBills();
        const s5 = await tableBill.joinOrOpen({ tenantId: w.tenant._id, table: '5', userId: (await guest('9000000049')).user._id });
        const o = await round(b, sb);
        assert.equal((await owner('post', `/dine-in/orders/${o._id}/move`, { toSessionId: String(s5._id) })).status, 400);
        const dead = await round(a, sa, { status: 'cancelled' });
        assert.equal((await owner('post', `/dine-in/orders/${dead._id}/move`, { toSessionId: String(sb._id) })).status, 409);
    });

    test('two bills that are one group merge: rounds, guests and calls go to one bill, the other closes and points at it', async () => {
        const { a, b, sa, sb } = await twoBills();
        await round(a, sa); const ob = await round(b, sb);
        const req = await TableRequest.create({ tenantId: w.tenant._id, sessionId: sb._id, table: '4', userId: b.user._id, kind: 'water' });
        const r = await owner('post', `/dine-in/sessions/${sb._id}/merge`, { intoSessionId: String(sa._id) });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.into.label, 'A');
        assert.equal(await Order.countDocuments({ tableSessionId: sa._id }), 2);
        assert.equal((await Order.findById(ob._id)).tableParty, 'A');
        const closed = await TableSession.findById(sb._id);
        assert.equal(closed.status, 'closed');
        assert.equal(String(closed.mergedInto), String(sa._id));
        const merged = await TableSession.findById(sa._id);
        assert.equal(merged.customers.length, 2);
        assert.equal(String((await TableRequest.findById(req._id)).sessionId), String(sa._id));
        assert.equal((await owner('post', `/dine-in/sessions/${sb._id}/merge`, { intoSessionId: String(sa._id) })).status, 409, 'B is already closed');
        assert.equal((await owner('post', `/dine-in/sessions/${sa._id}/merge`, { intoSessionId: String(sa._id) })).status, 400);
    });
});
