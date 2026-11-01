require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const notify = require('../src/services/notificationService');

// The platform team changes a shop's rent or free period: the owner gets a push that opens the Rent page. Platform-wide money settings stay private.
let w; let boss; let calls; let realToOwner;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('notice-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    calls = [];
    realToOwner = notify.toOwner;
    notify.toOwner = async (tenantId, p) => { calls.push({ tenantId: String(tenantId), ...p }); return {}; };
});
const api = (m, url, body) => request(app)[m](`/api/admin${url}`).set({ Authorization: `Bearer ${boss.token}` }).send(body);
const wait = () => new Promise((r) => setTimeout(r, 50));

describe('shop notices', () => {
    test('ending the free period tells the owner and opens the Rent page; the shop owner side only', async () => {
        try {
            const r = await api('post', `/tenants/${w.tenant._id}/billing/end-free`, {});
            assert.equal(r.status, 200, JSON.stringify(r.body));
            await wait();
            const n = calls.filter((c) => c.title === 'Your free period has ended');
            assert.equal(n.length, 1);
            assert.equal(n[0].tenantId, String(w.tenant._id));
            assert.equal(n[0].data.kind, 'rent');
        } finally { notify.toOwner = realToOwner; }
    });

    test('starting the free period (go live) tells the owner', async () => {
        try {
            const r = await api('post', `/tenants/${w.tenant._id}/billing/go-live`, { force: true });
            assert.equal(r.status, 200, JSON.stringify(r.body));
            await wait();
            assert.equal(calls.filter((c) => c.title === 'Your free period has started').length, 1);
        } finally { notify.toOwner = realToOwner; }
    });

    test('platform-wide SMS prices tell no shop', async () => {
        try {
            await api('put', '/platform/sms', { pricePerSms: 1 });
            await wait();
            assert.equal(calls.length, 0);
        } finally { notify.toOwner = realToOwner; }
    });
});
