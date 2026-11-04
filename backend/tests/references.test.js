require('./helpers/env');
// One quotable reference for every document, unique across all shops (SAV-1042), made when it is created, filled in for old ones, and found again.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const refs = require('../src/services/refs');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const SmsTopup = require('../src/models/SmsTopup');
const TableSession = require('../src/models/TableSession');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });

describe('references', () => {
    test('every shop gets its own short code from its name, never the same as another', async () => {
        const a = await Tenant.create({ slug: 'sav-a', name: 'Savera Restaurant', phone: '9000000001' }).catch(() => null);
        assert.equal(refs.candidates('Savera Restaurant', 'x')[0], 'SAV');
        assert.deepEqual(refs.candidates('Burger King Express', 'x').slice(0, 3), ['BUR', 'BURG', 'BURGE']);
        const w1 = await f.makeWorld('rf-one-' + Date.now().toString(36));
        const w2 = await f.makeWorld('rf-two-' + Date.now().toString(36));
        const c1 = (await Tenant.findById(w1.tenant._id).lean()).refCode;
        const c2 = (await Tenant.findById(w2.tenant._id).lean()).refCode;
        assert.match(c1, /^[A-Z0-9]{2,6}$/);
        assert.notEqual(c1, c2);
        assert.ok(a === null || a.refCode);
    });

    test('a new order, top-up and table bill get their reference when they are made; the order one is shop code plus number', async () => {
        const w = await f.makeWorld('rf-new-' + Date.now().toString(36));
        const code = (await Tenant.findById(w.tenant._id).lean()).refCode;
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        const fresh = await Order.findById(o._id).lean();
        assert.equal(fresh.ref, `${code}-${fresh.orderNo}`);
        const t1 = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 10000 });
        const t2 = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 20000 });
        assert.equal(t1.ref, `${code}-T1`);
        assert.equal(t2.ref, `${code}-T2`);
        const s1 = await TableSession.create({ tenantId: w.tenant._id, table: '4', party: 1, customers: [w.customer.user._id], status: 'open' });
        assert.equal(s1.ref, `${code}-B1`);
    });

    test('old documents without a reference are filled in once, in the order they were made, and the counters carry on', async () => {
        const w = await f.makeWorld('rf-old-' + Date.now().toString(36));
        const code = (await Tenant.findById(w.tenant._id).lean()).refCode;
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        await Order.collection.updateOne({ _id: o._id }, { $unset: { ref: 1 } });
        const a = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 10000 });
        const b = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 20000 });
        await SmsTopup.collection.updateMany({}, { $unset: { ref: 1 } });
        await require('../src/models/Counter').deleteMany({ _id: new RegExp('^ref:') });

        const r = await refs.backfillAll();
        assert.equal(r.order, 1);
        assert.equal(r.topup, 2);
        assert.equal((await Order.findById(o._id).lean()).ref, `${code}-${(await Order.findById(o._id).lean()).orderNo}`);
        assert.equal((await SmsTopup.findById(a._id).lean()).ref, `${code}-T1`);
        assert.equal((await SmsTopup.findById(b._id).lean()).ref, `${code}-T2`);
        const c = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 30000 });
        assert.equal(c.ref, `${code}-T3`, 'the next one carries on');
        const again = await refs.backfillAll();
        assert.equal(again.order + again.topup + again.table, 0, 'running it again changes nothing');
    });

    test('resolve finds a document by its reference, and the admin search and order list understand it', async () => {
        const w = await f.makeWorld('rf-find-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        const ref = (await Order.findById(o._id).lean()).ref;
        const hit = await refs.resolve(ref.toLowerCase());
        assert.equal(hit.kind, 'order');
        assert.equal(String(hit.docs[0]._id), String(o._id));
        assert.equal(await refs.resolve('ZZZ-1'), null);
        assert.equal(await refs.resolve('hello'), null);

        const list = await request(app).get('/api/admin/orders').query({ q: ref }).set(auth());
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].ref, ref);

        const s = await request(app).get('/api/admin/search').query({ q: ref }).set(auth());
        assert.equal(s.status, 200);
        assert.ok(s.body.refs.some((x) => x.ref === ref && x.kind === 'order'));
    });
});
