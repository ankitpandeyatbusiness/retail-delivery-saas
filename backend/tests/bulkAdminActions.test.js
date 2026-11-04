require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');

// The super admin can cancel a stuck paid bulk order and write down a balance, but only the supreme admin: both touch money.
let w; let boss; let other; let n = 0;
const FAKE = '64b000000000000000000001';
const post = (admin, path, body) => request(app).post(`/api/admin/tenants/${w.tenant._id}/shop/bulk/${FAKE}/${path}`).set({ Authorization: `Bearer ${admin.token}` }).send(body || {});

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`bulk-admin-${++n}`);
    boss = await f.makeSuperAdmin('boss@example.com');
    other = await f.makeSuperAdmin('helper@example.com', { phones: ['9000000001'] });
});

describe('Bulk order actions from the super admin app', () => {
    test('a helper super admin cannot cancel or write down a balance', async () => {
        for (const p of ['cancel', 'cash-received']) {
            const r = await post(other, p, { reason: 'stuck' });
            assert.equal(r.status, 403, p);
            assert.equal(r.body.supremeOnly, true, p);
        }
    });

    test('the supreme admin gets past the guard (the order itself is simply not found)', async () => {
        for (const p of ['cancel', 'cash-received']) {
            const r = await post(boss, p, { reason: 'stuck' });
            assert.notEqual(r.status, 403, p);
            assert.ok(r.status >= 400 && r.status < 500, `${p} ${r.status}`);
        }
    });
});
