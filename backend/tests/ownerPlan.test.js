require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Notification = require('../src/models/Notification');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The owner can read his monthly fee plan, and is told when the platform (or the platform for his shop only) changes it.
let a; let b; let auth;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    a = await f.makeWorld('plan-a');
    b = await f.makeWorld('plan-b');
    tenantRecognizer.invalidateTenant('plan-a'); tenantRecognizer.invalidateTenant('plan-b');
    auth = { Authorization: `Bearer ${(await f.makeSuperAdmin('plan@example.com')).token}` };
});
const status = (w) => request(app).get('/api/shop/billing/status').set(w.owner.headers);
const inbox = (w) => Notification.find({ tenantId: w.tenant._id, role: 'owner', type: 'platform_message', 'data.kind': 'fee_plan' }).lean();
const waitInbox = async (w, n) => { for (let i = 0; i < 30; i += 1) { const x = await inbox(w); if (x.length >= n) return x; await f.sleep(100); } return inbox(w); };
const putTiers = (tiers) => request(app).put('/api/admin/platform/billing/tiers').set(auth).send({ tiers });

describe('fee plan', () => {
    test('the owner sees the plan as a table', async () => {
        const r = await status(a);
        assert.equal(r.status, 200);
        assert.equal(r.body.plan.kind, 'tiers');
        assert.deepEqual(r.body.plan.tiers.map((t) => t.fee), [3000, 6000, 10000]);
        assert.equal(r.body.plan.tiers[0].label, '0 to 305 orders');
        assert.equal(r.body.plan.tiers[2].to, null);
    });

    test('a shop with a fixed fee sees that instead', async () => {
        await Tenant.updateOne({ _id: a.tenant._id }, { $set: { 'billing.fixedFeeOverride': 2500 } });
        const r = await status(a);
        assert.equal(r.body.plan.kind, 'fixed');
        assert.equal(r.body.plan.fee, 2500);
    });

    test('changing the platform plan tells every shop on it, and a repeat of the same plan tells nobody', async () => {
        const tiers = [{ upTo: 100, fee: 1000 }, { upTo: null, fee: 2000 }];
        const r = await putTiers(tiers);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.shopsTold, 2);
        const x = await waitInbox(a, 1);
        assert.equal(x.length, 1);
        assert.match(x[0].body, /0 to 100 orders: Rs 1,000/);
        assert.equal((await waitInbox(b, 1)).length, 1);
        assert.deepEqual((await status(a)).body.plan.tiers.map((t) => t.fee), [1000, 2000], 'the new plan is what he sees');

        const again = await putTiers(tiers);
        assert.equal(again.body.shopsTold, 0);
        await f.sleep(300);
        assert.equal((await inbox(a)).length, 1, 'no second message');
    });

    test('a shop with its own plan is not told about the platform plan, but is told when his own plan changes', async () => {
        await Tenant.updateOne({ _id: b.tenant._id }, { $set: { 'billing.tiersOverride': [{ upTo: null, fee: 500 }] } });
        const r = await putTiers([{ upTo: 50, fee: 900 }, { upTo: null, fee: 1900 }]);
        assert.equal(r.body.shopsTold, 1);
        await waitInbox(a, 1);
        assert.equal((await inbox(b)).length, 0);

        const own = await request(app).put(`/api/admin/tenants/${b.tenant._id}/billing`).set(auth).send({ fixedFeeOverride: 700 });
        assert.equal(own.status, 200, JSON.stringify(own.body));
        const told = await waitInbox(b, 1);
        assert.equal(told.length, 1);
        assert.match(told[0].body, /fixed Rs 700/);
    });
});
