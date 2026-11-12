require('./helpers/env');
process.env.DEMO_LEAD_LIMIT = '1000';   // the real limit is 6 a day per visitor address
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const demoTenant = require('../src/services/demoTenant');
const demoReset = require('../src/services/demoReset');
const DemoLead = require('../src/models/DemoLead');
const Notification = require('../src/models/Notification');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    require('../src/middlewares/tenantRecognizer').invalidateTenant(demoTenant.SLUG);
    await demoReset.ensureReady();
});
const H = { 'x-tenant-slug': demoTenant.SLUG };
const lead = (b = {}) => request(app).post('/api/demo/lead').set(H).send({ name: 'Rakesh Gupta', shopName: 'Gupta Sweets', phone: '9876501234', language: 'hi', stories: ['order', 'owner'], ...b });
const admin = async (phones) => f.makeSuperAdmin(`boss${Date.now()}${Math.random()}@test.com`, phones ? { phones } : undefined);

describe('demo leads', () => {
    test('a visitor leaves name, shop and number: saved, and the supreme admin is told', async () => {
        const r = await lead();
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        const row = await DemoLead.findOne({ phone: '9876501234' });
        assert.equal(row.name, 'Rakesh Gupta');
        assert.equal(row.shopName, 'Gupta Sweets');
        assert.equal(row.language, 'hi');
        assert.deepEqual(row.stories, ['order', 'owner']);
        assert.equal(row.status, 'new');
        assert.ok(row.ipHash && row.ipHash.length === 24, 'the address itself is never stored');
        const n = await Notification.findOne({ type: 'admin_demo_lead' });
        assert.ok(n, 'a notification was made');
        assert.equal(n.supremeOnly, true);
        assert.match(n.title, /Rakesh/);
    });

    test('bad details are refused', async () => {
        assert.equal((await lead({ name: 'A' })).status, 400);
        assert.equal((await lead({ shopName: '' })).status, 400);
        assert.equal((await lead({ phone: '12345' })).status, 400);
        assert.equal(await DemoLead.countDocuments({}), 0);
    });

    test('a robot that fills the hidden field is thanked and ignored', async () => {
        const r = await lead({ website: 'http://spam.example' });
        assert.equal(r.status, 200);
        assert.equal(await DemoLead.countDocuments({}), 0);
        assert.equal(await Notification.countDocuments({ type: 'admin_demo_lead' }), 0);
    });

    test('the same number again is one lead, counted twice; weird story names are dropped', async () => {
        await lead();
        await lead({ stories: ['follow', '<script>'] });
        assert.equal(await DemoLead.countDocuments({}), 1);
        const row = await DemoLead.findOne({});
        assert.equal(row.times, 2);
        assert.deepEqual([...row.stories].sort(), ['follow', 'order', 'owner']);
    });

    test('only the demo shop takes leads', async () => {
        const t = await f.makeTenant(`real-${Date.now()}`);
        const r = await request(app).post('/api/demo/lead').set({ 'x-tenant-slug': t.slug }).send({ name: 'Rakesh', shopName: 'Shop', phone: '9876501234' });
        assert.equal(r.status, 403);
    });

    test('the superadmin lists, searches, marks called, adds a note and deletes', async () => {
        await lead();
        await lead({ name: 'Meena Rao', shopName: 'Rao Cafe', phone: '9123456789' });
        const { token } = await admin();
        const A = { Authorization: `Bearer ${token}` };
        const all = await request(app).get('/api/admin/demo-leads').set(A);
        assert.equal(all.status, 200);
        assert.equal(all.body.items.length, 2);
        assert.equal(all.body.new, 2);
        const q = await request(app).get('/api/admin/demo-leads?q=Rao').set(A);
        assert.equal(q.body.items.length, 1);
        const id = q.body.items[0].id;
        const upd = await request(app).patch(`/api/admin/demo-leads/${id}`).set(A).send({ status: 'called', note: 'Wants plan details' });
        assert.equal(upd.body.status, 'called');
        assert.equal(upd.body.note, 'Wants plan details');
        assert.ok(upd.body.calledAt);
        assert.equal((await request(app).get('/api/admin/demo-leads?status=new').set(A)).body.items.length, 1);
        assert.equal((await request(app).get('/api/admin/demo-leads').set(A)).body.new, 1);
        assert.equal((await request(app).delete(`/api/admin/demo-leads/${id}`).set(A)).status, 200);
        assert.equal(await DemoLead.countDocuments({}), 1);
        assert.equal((await request(app).patch('/api/admin/demo-leads/nonsense').set(A).send({ status: 'called' })).status, 404);
    });

    test('the leads need a superadmin login', async () => {
        assert.equal((await request(app).get('/api/admin/demo-leads')).status, 401);
    });

    test('the privacy text tells visitors that we may call them', async () => {
        const r = await request(app).get('/api/legal/public/privacy').set(H);
        assert.equal(r.status, 200);
        assert.match(JSON.stringify(r.body), /demo/i);
        assert.match(JSON.stringify(r.body), /call you/);
    });
});
