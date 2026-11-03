require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const watch = require('../src/services/healthWatch');

// The red-light watcher: a card that turns red is told ONCE, again after 6 hours if it stays red, and forgotten when it turns normal.
let boss;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); boss = await f.makeSuperAdmin('boss@example.com'); });

const summary = (over = {}) => ({
    system: { level: 'good', note: 'fine' }, payments: { level: 'good', note: 'fine' }, sms: { level: 'good', note: 'fine', failing: false },
    rent: { level: 'good', note: 'fine' }, orders: { level: 'good', note: 'fine' }, google: { level: 'good', note: 'fine' }, ...over,
});
const inbox = async () => (await request(app).get('/api/admin/notifications').set({ Authorization: `Bearer ${boss.token}` })).body.items.filter((n) => n.type === 'admin_platform_red');

describe('red alerts', () => {
    test('told once when a card turns red; again after 6 hours; forgotten when it recovers', async () => {
        const t0 = new Date('2026-11-04T10:00:00Z');
        const red = summary({ rent: { level: 'bad', note: '3 bills are overdue (5,000 rupees)' } });
        assert.equal(await watch.check(t0, { summary: summary() }), 0);                          // all fine: nothing sent
        assert.equal(await watch.check(t0, { summary: red }), 1);
        assert.equal(await watch.check(new Date(t0.getTime() + 20 * 60000), { summary: red }), 0);   // still red, too soon
        let n = await inbox();
        assert.equal(n.length, 1);
        assert.match(n[0].title, /Rent is red/);
        assert.match(n[0].body, /3 bills are overdue/);
        assert.equal(n[0].data.kind, 'health');

        assert.equal(await watch.check(new Date(t0.getTime() + 7 * 3600000), { summary: red }), 1);   // still red after 6 hours
        n = await inbox();
        assert.equal(n.length, 2);
        assert.ok(n.some((x) => /red again/.test(x.title)));

        await watch.check(new Date(t0.getTime() + 8 * 3600000), { summary: summary() });             // back to normal
        const s = await PlatformSettings.findById('main').select('alerts.healthState').lean();
        assert.deepEqual(Object.keys(s?.alerts?.healthState || {}), []);
        assert.equal(await watch.check(new Date(t0.getTime() + 9 * 3600000), { summary: red }), 1);   // a new red is told at once
    });

    test('cards that alert by themselves are left out, two red cards are two alerts, and the same moment never sends twice', async () => {
        const t0 = new Date('2026-11-04T10:00:00Z');
        const both = summary({ payments: { level: 'bad', note: 'x' }, sms: { level: 'bad', note: 'down', failing: true }, system: { level: 'bad', note: 'No backup yet' }, orders: { level: 'bad', note: 'down 50%' } });
        assert.equal(await watch.check(t0, { summary: both }), 2);                                  // system and orders only
        assert.equal(await watch.check(t0, { summary: both }), 0);
        const lossy = summary({ sms: { level: 'bad', note: 'SMS is costing more than it earns', failing: false } });
        assert.equal(await watch.check(new Date(t0.getTime() + 60000), { summary: lossy }), 1);     // SMS red for another reason
    });
});
