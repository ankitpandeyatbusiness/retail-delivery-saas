require('./helpers/env');
// Who owes you: a note and a promise date per shop, shown with the shop, and an alert on the promise day.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const CollectionNote = require('../src/models/CollectionNote');
const Notification = require('../src/models/Notification');
const digest = require('../src/services/dailyDigest');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const ymd = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const owe = (w, no, daysLate) => SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: no, issueDate: new Date(Date.now() - 20 * 86400000), dueDate: new Date(Date.now() - daysLate * 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending' });

describe('collection notes', () => {
    test('a promise is saved, shown with the shop in Who owes you, replaced by a newer one and closed', async () => {
        const w = await f.makeWorld('cn-' + Date.now().toString(36));
        await owe(w, 'CN/1', 5);
        const base = `/api/admin/finance/receivables/${w.tenant._id}`;
        const tomorrow = ymd(Date.now() + 86400000);

        let r = await request(app).post(`${base}/note`).set(auth()).send({ note: 'Says he will pay on Friday', promiseDate: tomorrow });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const first = r.body.id;
        const list = await request(app).get('/api/admin/finance/receivables').set(auth());
        const shop = list.body.shops.find((s) => s.tenantId === String(w.tenant._id));
        assert.equal(shop.promise.note, 'Says he will pay on Friday');
        assert.equal(shop.promise.late, false);

        r = await request(app).post(`${base}/note`).set(auth()).send({ note: 'Now says Monday' });
        assert.equal(r.status, 200);
        const all = await request(app).get(`${base}/notes`).set(auth());
        assert.equal(all.body.items.length, 2);
        assert.equal(all.body.items.find((x) => x.id === first).status, 'closed', 'the old promise is closed by the new one');

        assert.equal((await request(app).post(`${base}/note`).set(auth()).send({ note: 'hi' })).status, 400);
        assert.equal((await request(app).post(`${base}/note`).set(auth()).send({ note: 'Will pay soon', promiseDate: ymd(Date.now() - 3 * 86400000) })).status, 400, 'not in the past');
        const done = await request(app).patch(`/api/admin/finance/notes/${r.body.id}`).set(auth()).send({ outcome: 'paid' });
        assert.equal(done.body.status, 'paid');
        assert.equal((await request(app).patch(`/api/admin/finance/notes/${r.body.id}`).set(auth()).send({ outcome: 'paid' })).status, 404, 'already closed');
    });

    test('on the promise day the shop that still owes gets one alert, a shop that has paid is closed quietly', async () => {
        const a = await f.makeWorld('cd-a-' + Date.now().toString(36));
        const b = await f.makeWorld('cd-b-' + Date.now().toString(36));
        await owe(a, 'CD/1', 3);
        await CollectionNote.create({ tenantId: a.tenant._id, note: 'Will pay today', promiseDate: new Date(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00+05:30') });
        await CollectionNote.create({ tenantId: b.tenant._id, note: 'Paid already', promiseDate: new Date(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00+05:30') });

        await digest.promisesDue(Date.now());
        await new Promise((ok) => setTimeout(ok, 300));
        const told = await Notification.find({ role: 'superadmin', type: 'admin_promise_due' }).lean();
        assert.equal(told.length, 1);
        assert.equal(String(told[0].tenantId), String(a.tenant._id));
        assert.equal((await CollectionNote.findOne({ tenantId: b.tenant._id }).lean()).status, 'paid');

        await digest.promisesDue(Date.now());
        await new Promise((ok) => setTimeout(ok, 300));
        assert.equal(await Notification.countDocuments({ role: 'superadmin', type: 'admin_promise_due' }), 1, 'only once');
    });
});
