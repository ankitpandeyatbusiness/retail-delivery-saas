require('./helpers/env');
// The settings the superadmin can now edit for a shop: kitchen queue and offers, how riders are paid, the cash limit, the monthly report.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const { validateSettings } = require('../src/services/tenantConfigService');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });

describe('settings the superadmin can edit', () => {
    test('good values are accepted, bad ones are refused with the field named', () => {
        const ok = validateSettings({
            orders: { kitchenQueueSec: 90, kitchenOfferMode: 'always', kitchenOfferPercent: 15 },
            riders: { pay: { type: 'distance', base: 20, freeKm: 2, perKm: 8 }, trackPayouts: true, payUndelivered: true, cashLimit: 2500 },
            notifications: { monthlyReport: false },
        });
        assert.deepEqual(ok.errors, []);
        assert.equal(ok.clean.orders.kitchenQueueSec, 90);
        assert.equal(ok.clean.riders.pay.type, 'distance');
        assert.equal(ok.clean.riders.cashLimit, 2500);
        assert.equal(ok.clean.notifications.monthlyReport, false);

        const bad = validateSettings({ orders: { kitchenQueueSec: 5, kitchenOfferPercent: 12 }, riders: { pay: { type: 'percent', percent: 0 }, cashLimit: -1 } });
        const text = bad.errors.join(' | ');
        assert.match(text, /kitchenQueueSec/);
        assert.match(text, /kitchenOfferPercent/);
        assert.match(text, /percent/);
        assert.match(text, /cashLimit/);
    });

    test('a salary plan with its period, saved through the superadmin route, is read back', async () => {
        const w = await f.makeWorld('sf-' + Date.now().toString(36));
        const r = await request(app).put('/api/admin/tenants/' + w.tenant._id).set({ Authorization: 'Bearer ' + token })
            .send({ settings: { riders: { pay: { type: 'salary_plus', salary: 8000, salaryEvery: 'week', perDelivery: 15 }, trackPayouts: true }, orders: { kitchenOfferMode: 'never' }, notifications: { monthlyReport: false } } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const t = await Tenant.findById(w.tenant._id).lean();
        assert.equal(t.settings.riders.pay.type, 'salary_plus');
        assert.equal(t.settings.riders.pay.salaryEvery, 'week');
        assert.equal(t.settings.orders.kitchenOfferMode, 'never');
        assert.equal(t.settings.notifications.monthlyReport, false);
    });
});
