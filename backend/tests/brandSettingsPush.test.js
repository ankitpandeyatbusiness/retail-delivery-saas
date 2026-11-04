require('./helpers/env');
// "Apply to all branches": copy settings groups of one branch onto others. Never the map pin, the keys or what an owner switches by hand.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');

let token;
const A = () => ({ Authorization: 'Bearer ' + token });
const post = (u, b) => request(app).post(u).set(A()).send(b || {});
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });

describe('apply settings to all branches', () => {
    test('copies the chosen groups, keeps each branch\'s pin and its owner\'s hand switches, refuses strangers and unknown groups', async () => {
        const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
        const add = async (slug) => (await post('/api/admin/brands/' + brand._id + '/branches', { name: 'Savera ' + slug, slug: 'sv-' + slug, city: slug })).body;
        await add('one'); await add('two'); await add('three');
        const [one, two, three] = await Promise.all(['one', 'two', 'three'].map((s) => Tenant.findOne({ slug: 'sv-' + s })));
        await Tenant.updateOne({ _id: one._id }, { $set: { 'settings.orders': { minOrder: 250, packagingCharge: 10, acceptingOrders: true }, 'settings.hours': { weekly: { mon: [{ open: '10:00', close: '22:00' }] } }, 'settings.features': { vegToggle: true } } });
        await Tenant.updateOne({ _id: two._id }, { $set: { 'settings.orders': { minOrder: 100, acceptingOrders: false, pausedUntil: '2099-01-01T00:00:00.000Z' }, 'delivery.latitude': 12.9, 'delivery.longitude': 77.6, 'delivery.radiusKm': 4 } });

        const r = await post('/api/admin/brands/' + brand._id + '/settings/push', { fromTenantId: String(one._id), toTenantIds: [String(two._id), String(three._id)], sections: ['orders', 'hours', 'features'] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.applied.length, 2);

        const t2 = await Tenant.findById(two._id).lean();
        assert.equal(t2.settings.orders.minOrder, 250);
        assert.equal(t2.settings.orders.packagingCharge, 10);
        assert.equal(t2.settings.orders.acceptingOrders, false, 'the owner\'s own switch stays');
        assert.ok(t2.settings.orders.pausedUntil, 'and his pause');
        assert.equal(t2.settings.hours.weekly.mon[0].open, '10:00');
        assert.equal(t2.settings.features.vegToggle, true);
        assert.equal(t2.delivery.latitude, 12.9, 'the map pin is never copied');
        assert.equal(t2.delivery.radiusKm, 4);
        const t3 = await Tenant.findById(three._id).lean();
        assert.equal(t3.settings.orders.minOrder, 250);
        assert.equal(t3.settings.orders.acceptingOrders, undefined, 'a hand switch the target never had is not copied');

        // a group that only the source never saved is skipped, an unknown group is refused, a shop of another brand is refused
        assert.equal((await post('/api/admin/brands/' + brand._id + '/settings/push', { fromTenantId: String(one._id), toTenantIds: [String(two._id)], sections: ['payments'] })).status, 400);
        assert.equal((await post('/api/admin/brands/' + brand._id + '/settings/push', { fromTenantId: String(one._id), toTenantIds: [String(two._id)], sections: [] })).status, 400);
        const stranger = await f.makeTenant('stranger-' + Date.now().toString(36));
        const bad = await post('/api/admin/brands/' + brand._id + '/settings/push', { fromTenantId: String(one._id), toTenantIds: [String(stranger._id)], sections: ['orders'] });
        assert.equal(bad.status, 400, 'no other branch chosen that belongs to this brand');
    });
});
