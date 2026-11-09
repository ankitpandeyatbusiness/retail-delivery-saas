require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const sw = require('../src/services/channelSwitch');

// Phase 10: the web / app god switches. The apps are told in the config; NEW customer work is refused on a channel that is off; reads and staff are untouched.
let w; let slug; let n = 0;
const set = async (webEnabled, nativeEnabled) => {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'pro', endsAt: new Date(Date.now() + 9 * 86400000), webEnabled, nativeEnabled }, androidPackage: 'in.test.shop' } });
    tenantRecognizer.invalidateTenant(slug);
};
const cfg = (client) => request(app).get('/api/tenants/config').set(w.customer.headers).set(client ? { 'x-client': client } : {});
const order = (client) => request(app).post('/api/orders').set(w.customer.headers).set(client ? { 'x-client': client } : {}).send({});

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `chan-${++n}`;
    w = await f.makeWorld(slug);
});

describe('what the config tells each client', () => {
    test('both on: nothing is off; the website gets a "get the app" link, the app does not get a website button', async () => {
        await set(true, true);
        const app1 = (await cfg()).body.channel;
        assert.deepEqual([app1.off, app1.kind, app1.webUrl], [false, 'ok', null]);
        const web = (await cfg('web')).body.channel;
        assert.equal(web.off, false);
        assert.equal(web.getAppUrl, 'https://play.google.com/store/apps/details?id=in.test.shop');
    });

    test('app off: the installed app is told the shop is on the website, with the address; the website works', async () => {
        await set(true, false);
        const a = (await cfg()).body.channel;
        assert.deepEqual([a.off, a.kind], [true, 'web_only']);
        assert.equal(a.webUrl, `https://${slug}.vivyaan.co.in`);
        assert.match(a.message, /on the website/);
        assert.equal((await cfg('web')).body.channel.off, false);
    });

    test('website off: the website is told "app only" with the Play Store link; the app works', async () => {
        await set(false, true);
        const web = (await cfg('web')).body.channel;
        assert.deepEqual([web.off, web.kind], [true, 'app_only']);
        assert.equal(web.playStoreUrl, 'https://play.google.com/store/apps/details?id=in.test.shop');
        assert.equal((await cfg()).body.channel.off, false);
    });

    test('both off: both clients are told temporarily unavailable', async () => {
        await set(false, false);
        for (const c of [undefined, 'web']) {
            const ch = (await cfg(c)).body.channel;
            assert.deepEqual([ch.off, ch.kind], [true, 'unavailable']);
        }
    });

    test('a shop with no plan, or no switch set, is on both channels', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { plan: 1 } });
        tenantRecognizer.invalidateTenant(slug);
        assert.equal((await cfg()).body.channel.off, false);
        assert.equal(sw.stateOf({ plan: { id: 'growth' } }, 'app').off, false);
    });
});

describe('new customer work is refused on a channel that is off', () => {
    test('an order from the app is refused with the website address; reads still work', async () => {
        await set(true, false);
        const r = await order();
        assert.equal(r.status, 409);
        assert.equal(r.body.channelOff, true);
        assert.equal(r.body.kind, 'web_only');
        assert.equal(r.body.webUrl, `https://${slug}.vivyaan.co.in`);
        assert.equal((await request(app).get('/api/orders').set(w.customer.headers)).status, 200);   // order history stays readable
        assert.notEqual((await order('web')).status, 409);   // the website is on: the order is refused for another reason (an empty cart), not the switch
    });

    test('an order from the website is refused when the website is off', async () => {
        await set(false, true);
        const r = await order('web');
        assert.equal(r.status, 409);
        assert.equal(r.body.kind, 'app_only');
        assert.notEqual((await order()).body.channelOff, true);
    });

    test('owners are never blocked by it', async () => {
        await set(false, false);
        assert.notEqual((await request(app).get('/api/shop/orders').set(w.owner.headers)).status, 409);
        assert.equal((await request(app).get('/api/shop/plan').set(w.owner.headers)).status, 200);
    });
});

describe('the supreme admin switches', () => {
    test('toggling updates what the apps are told, at once', async () => {
        await set(true, true);
        const admin = await f.makeSuperAdmin();
        const put = (b) => request(app).put(`/api/admin/tenants/${w.tenant._id}/plan/terms`).set({ Authorization: `Bearer ${admin.token}` }).send(b);
        assert.equal((await put({ nativeEnabled: false })).status, 200);
        assert.equal((await cfg()).body.channel.kind, 'web_only');
        assert.equal((await put({ webEnabled: false })).status, 200);
        assert.equal((await cfg()).body.channel.kind, 'unavailable');
        assert.equal((await put({ webEnabled: true, nativeEnabled: true })).status, 200);
        assert.equal((await cfg()).body.channel.off, false);
    });
});
