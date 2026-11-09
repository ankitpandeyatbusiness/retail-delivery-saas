require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const ShopAutomation = require('../src/models/ShopAutomation');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const automations = require('../src/services/automations');

// The Automations screen only holds rules whose feature is in the shop's plan; the server keeps the others off and refuses to switch them on.
let w; let slug; let n = 0;
const setPlan = async (id, extras) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id, extras } } }); tenantRecognizer.invalidateTenant(slug); };
const call = (m, p, b) => request(app)[m](`/api/shop/automations${p}`).set(w.owner.headers).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `auto-plan-${++n}`;
    w = await f.makeWorld(slug);
});

describe('rules that need a feature', () => {
    test('Partner: kitchen-problem reminders, approving staff leave and closing quiet inquiries are off', async () => {
        await setPlan('partner');
        await ShopAutomation.create({ tenantId: w.tenant._id, kitchenProblemReminders: true, autoApproveLeave: true, inquiryCloseDays: 7 });   // set before the downgrade
        const g = (await call('get', '')).body;
        assert.equal(g.kitchenProblemReminders, false);
        assert.equal(g.autoApproveLeave, false);
        assert.equal(g.inquiryCloseDays, 0);
        assert.equal(g.complaintReminders, true);   // a rule every plan has is untouched
        assert.equal(g.pickupNotCollectedMin, 60);
    });

    test('Partner cannot switch them on; the other settings still save', async () => {
        await setPlan('partner');
        const r = await call('put', '', { autoApproveLeave: true, kitchenProblemReminders: true, inquiryCloseDays: 14, complaintReminders: false });
        assert.equal(r.status, 200);
        assert.equal(r.body.autoApproveLeave, false);
        assert.equal(r.body.kitchenProblemReminders, false);
        assert.equal(r.body.inquiryCloseDays, 0);
        assert.equal(r.body.complaintReminders, false);   // this one is in every plan
        const row = await ShopAutomation.findOne({ tenantId: w.tenant._id }).lean();
        assert.equal(row.autoApproveLeave, undefined);   // nothing was written for the locked ones
    });

    test('Growth has the staff rules; Pro too; an extra opens a rule on Partner', async () => {
        await setPlan('growth');
        assert.equal((await call('put', '', { autoApproveLeave: true, kitchenProblemReminders: false })).body.autoApproveLeave, true);
        await setPlan('partner', [{ key: 'staffLogins' }]);
        assert.equal((await automations.get(w.tenant._id)).autoApproveLeave, true);
    });

    test('a shop with no plan keeps every rule', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { plan: 1 } });
        tenantRecognizer.invalidateTenant(slug);
        assert.equal((await call('put', '', { autoApproveLeave: true })).body.autoApproveLeave, true);
    });
});

describe('the screen follows the same rules', () => {
    test('every plan-bound row in the owner screen is a feature the catalog knows', () => {
        const fs = require('fs');
        const path = require('path');
        const plans = require('../src/config/plans');
        const src = fs.readFileSync(path.join(__dirname, '../../mobile/src/screens/owners/OwnerAutomationsScreen.jsx'), 'utf8');
        const m = src.match(/const NEEDS = \{([^}]*)\}/);
        assert.ok(m, 'NEEDS not found in OwnerAutomationsScreen');
        const used = [...m[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((x) => x[2]);
        assert.ok(used.length >= 5);
        for (const k of used) assert.ok(plans.FEATURES[k], `${k} is not a plan feature`);
    });
});

describe('other owner options follow the plan', () => {
    const msg = (audience) => request(app).post('/api/shop/messages').set(w.owner.headers).send({ title: 'Hello', body: 'A message', audience, kind: 'info' });

    test('messages to customers are custom push (Pro); riders can always be messaged', async () => {
        for (const plan of ['partner', 'growth']) {
            await setPlan(plan);
            assert.equal((await msg('customers')).status, 403, plan);
            assert.equal((await msg('both')).status, 403, plan);
            assert.notEqual((await msg('riders')).status, 403, plan);
        }
        await setPlan('pro');
        assert.notEqual((await msg('customers')).status, 403);
    });

    test('a shop with no plan is not limited', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { plan: 1 } });
        tenantRecognizer.invalidateTenant(slug);
        assert.notEqual((await msg('customers')).status, 403);
    });

    test('the owner app screens use the catalog feature names', () => {
        const fs = require('fs');
        const path = require('path');
        const plans = require('../src/config/plans');
        const root = path.join(__dirname, '../../mobile/src');
        const files = ['screens/owners/OwnerRiderRulesScreen.jsx', 'screens/owners/OwnerMessagesScreen.jsx', 'screens/owners/OwnerCustomersScreen.jsx', 'screens/owners/OwnerHomeScreen.jsx', 'screens/owners/SoundboxScreen.jsx', 'screens/common/AlertSettingsScreen.jsx', 'components/owners/OwnerDrawer.jsx'];
        for (const f of files) {
            const src = fs.readFileSync(path.join(root, f), 'utf8');
            for (const m of src.matchAll(/usePlanHas\('(\w+)'\)/g)) assert.ok(plans.FEATURES[m[1]], `${f}: ${m[1]} is not a plan feature`);
        }
    });
});
