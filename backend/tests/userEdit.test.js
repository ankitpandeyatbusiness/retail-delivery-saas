require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const AuditLog = require('../src/models/AuditLog');
const EmailJob = require('../src/models/EmailJob');
const Notification = require('../src/models/Notification');
const { hashPhone, maskPhone } = require('../src/utils/phoneHash');

before(() => db.connect());
after(() => db.disconnect());

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const adminUrl = (w, u, tail = '') => `/api/admin/tenants/${w.tenant._id}/users/${u._id}${tail}`;

describe('superadmin: see and edit a person', () => {
    test('the detail shows a masked phone, order numbers and Cash on delivery strikes', async () => {
        const w = await f.makeWorld('ue-detail');
        const { token } = await f.makeSuperAdmin('ue-detail@test.com');
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: new Date(), pricing: { subtotal: 190, total: 190 } });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled' });
        const res = await request(app).get(adminUrl(w, w.customer.user)).set(bearer(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.phone, maskPhone('9000000030'));
        assert.equal(res.body.stats.orders, 2);
        assert.equal(res.body.stats.delivered, 1);
        assert.equal(res.body.stats.cancelled, 1);
        assert.equal(res.body.stats.spentTotal, 190);
        assert.deepEqual(res.body.cod, { strikes: 0, blocked: false });
        const rider = await request(app).get(adminUrl(w, w.rider.user)).set(bearer(token));
        assert.equal(rider.body.rider.isActive, true);
    });

    test('name, email and notes are saved, an empty text clears them, and the audit log keeps the old values', async () => {
        const w = await f.makeWorld('ue-patch');
        const { token } = await f.makeSuperAdmin('ue-patch@test.com');
        await User.updateOne({ _id: w.customer.user._id }, { $set: { name: 'Old Name' } });
        const res = await request(app).patch(adminUrl(w, w.customer.user)).set(bearer(token))
            .send({ name: 'New Name', email: 'Anu@Mail.com', notes: 'Likes extra spicy' });
        assert.equal(res.status, 200);
        assert.equal(res.body.name, 'New Name');
        assert.equal(res.body.email, 'anu@mail.com');
        assert.equal(res.body.notes, 'Likes extra spicy');

        const clear = await request(app).patch(adminUrl(w, w.customer.user)).set(bearer(token)).send({ notes: '' });
        assert.equal(clear.status, 200);
        assert.equal(clear.body.notes, null);
        const row = await AuditLog.findOne({ tenantId: w.tenant._id, method: 'PATCH' }).sort({ at: 1, _id: 1 }).lean();
        assert.equal(row.before.name, 'Old Name');
    });

    test('bad input is refused: email, long texts, an empty body, and the phone in the wrong route', async () => {
        const w = await f.makeWorld('ue-bad');
        const { token } = await f.makeSuperAdmin('ue-bad@test.com');
        const patch = (b) => request(app).patch(adminUrl(w, w.customer.user)).set(bearer(token)).send(b);
        assert.equal((await patch({ email: 'not-an-email' })).status, 400);
        assert.equal((await patch({ name: 'x'.repeat(81) })).status, 400);
        assert.equal((await patch({ notes: 'x'.repeat(301) })).status, 400);
        assert.equal((await patch({})).status, 400);
        assert.equal((await patch({ phone: '9876543210' })).status, 400);
    });

    test('when an owner email changes, the OLD email gets a notice', async () => {
        const w = await f.makeWorld('ue-owner-mail');
        const { token } = await f.makeSuperAdmin('ue-owner-mail@test.com');
        await User.updateOne({ _id: w.owner.user._id }, { $set: { email: 'old@shop.test' } });
        const res = await request(app).patch(adminUrl(w, w.owner.user)).set(bearer(token)).send({ email: 'new@shop.test' });
        assert.equal(res.status, 200);
        await f.waitFor(async () => (await EmailJob.countDocuments({ to: 'old@shop.test' })) === 1);
        assert.equal(await EmailJob.countDocuments({ to: 'new@shop.test' }), 0);
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, type: 'owner_email_changed', role: 'owner' }), 1);
    });

    test('a customer email change, or the first email of an owner, sends no such notice', async () => {
        const w = await f.makeWorld('ue-no-notice');
        const { token } = await f.makeSuperAdmin('ue-no-notice@test.com');
        await User.updateOne({ _id: w.customer.user._id }, { $set: { email: 'c@mail.test' } });
        await request(app).patch(adminUrl(w, w.customer.user)).set(bearer(token)).send({ email: 'c2@mail.test' });
        await request(app).patch(adminUrl(w, w.owner.user)).set(bearer(token)).send({ email: 'first@shop.test' });
        await f.sleep(300);
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, type: 'owner_email_changed' }), 0);
    });

    test('a phone change: new number and hash, logins end, the audit log keeps old, new and the reason', async () => {
        const w = await f.makeWorld('ue-phone');
        const { token } = await f.makeSuperAdmin('ue-phone@test.com');
        const res = await request(app).patch(adminUrl(w, w.customer.user, '/phone')).set(bearer(token))
            .send({ phone: '9000000099', reason: 'He lost his old SIM' });
        assert.equal(res.status, 200);
        assert.equal(res.body.phone, maskPhone('9000000099'));
        const user = await User.findById(w.customer.user._id).lean();
        assert.equal(user.phone, '9000000099');
        assert.equal(user.phoneHash, hashPhone(w.tenant._id, '9000000099'));
        assert.equal(await Session.countDocuments({ userId: w.customer.user._id }), 0);
        const row = await AuditLog.findOne({ tenantId: w.tenant._id, method: 'PATCH', path: /\/phone$/ }).lean();
        assert.equal(row.before.phone, '9000000030');
        assert.equal(row.body.phone, '9000000099');
        assert.match(row.before.reason, /SIM/);
    });

    test('a phone change is refused for a bad number, no reason, the same number, or a number already in the shop', async () => {
        const w = await f.makeWorld('ue-phone-bad');
        const { token } = await f.makeSuperAdmin('ue-phone-bad@test.com');
        const put = (b) => request(app).patch(adminUrl(w, w.customer.user, '/phone')).set(bearer(token)).send(b);
        assert.equal((await put({ phone: '12345', reason: 'test reason' })).status, 400);
        assert.equal((await put({ phone: '9000000099' })).status, 400);
        assert.equal((await put({ phone: '9000000030', reason: 'test reason' })).status, 409);
        assert.equal((await put({ phone: '9000000010', reason: 'test reason' })).status, 409);   // the owner's number
    });

    test('only a superadmin can use these routes, and one shop cannot reach the people of another', async () => {
        const a = await f.makeWorld('ue-perm-a');
        const b = await f.makeWorld('ue-perm-b');
        const { token } = await f.makeSuperAdmin('ue-perm@test.com');
        assert.equal((await request(app).patch(adminUrl(a, a.customer.user, '/phone')).set(a.owner.headers)
            .send({ phone: '9000000099', reason: 'try it' })).status, 401);
        assert.equal((await request(app).get(adminUrl(a, a.customer.user)).set(a.owner.headers)).status, 401);
        assert.equal((await request(app).get(`/api/admin/tenants/${a.tenant._id}/users/${b.customer.user._id}`).set(bearer(token))).status, 404);
    });
});

describe('owner: his own customers', () => {
    test('the list shows only customers of his shop with full phones, and finds by phone and by name', async () => {
        const a = await f.makeWorld('oc-list-a');
        await f.makeWorld('oc-list-b');
        const second = await f.makeUser(a.tenant, 'customer', '9000000031');
        await User.updateOne({ _id: second.user._id }, { $set: { name: 'Meera Sharma' } });
        const all = await request(app).get('/api/shop/customers').set(a.owner.headers);
        assert.equal(all.status, 200);
        assert.deepEqual(all.body.items.map((i) => i.phone).sort(), ['9000000030', '9000000031']);   // no owner, no rider

        const byPhone = await request(app).get('/api/shop/customers?q=0031').set(a.owner.headers);
        assert.equal(byPhone.body.items.length, 1);
        const byName = await request(app).get('/api/shop/customers?q=meera').set(a.owner.headers);
        assert.equal(byName.body.items[0].phone, '9000000031');

        const page = await request(app).get('/api/shop/customers?limit=1').set(a.owner.headers);
        assert.equal(page.body.items.length, 1);
        assert.equal(page.body.hasMore, true);
    });

    test('one customer: the detail has order numbers, and a customer of another shop is 404', async () => {
        const a = await f.makeWorld('oc-one-a');
        const b = await f.makeWorld('oc-one-b');
        await f.makeOrder(a.tenant, a.customer.user, { status: 'delivered', deliveredAt: new Date(), pricing: { subtotal: 120, total: 120 } });
        const res = await request(app).get(`/api/shop/customers/${a.customer.user._id}`).set(a.owner.headers);
        assert.equal(res.status, 200);
        assert.equal(res.body.phone, '9000000030');
        assert.equal(res.body.stats.delivered, 1);
        assert.equal(res.body.stats.spentTotal, 120);
        assert.equal((await request(app).get(`/api/shop/customers/${b.customer.user._id}`).set(a.owner.headers)).status, 404);
    });

    test('the owner edits name, email and notes, but never a phone, an owner or a rider', async () => {
        const w = await f.makeWorld('oc-edit');
        const patch = (u, b) => request(app).patch(`/api/shop/customers/${u._id}`).set(w.owner.headers).send(b);
        const ok = await patch(w.customer.user, { name: 'Anita', email: 'anita@mail.test', notes: 'Allergic to nuts' });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.notes, 'Allergic to nuts');
        assert.equal((await patch(w.customer.user, { phone: '9111111111' })).status, 400);
        assert.equal((await patch(w.owner.user, { name: 'Boss' })).status, 403);
        assert.equal((await patch(w.rider.user, { name: 'Rider' })).status, 409);
        const saved = await User.findById(w.customer.user._id);
        assert.equal(saved.notes, 'Allergic to nuts');
        assert.equal(saved.toJSON().notes, undefined);   // the person never gets his private note back
        assert.equal(saved.phone, '9000000030');
    });

    test('a customer or a rider cannot use the customer tools', async () => {
        const w = await f.makeWorld('oc-perm');
        assert.equal((await request(app).get('/api/shop/customers').set(w.customer.headers)).status, 403);
        assert.equal((await request(app).get('/api/shop/customers').set(w.rider.headers)).status, 403);
        assert.equal((await request(app).patch(`/api/shop/customers/${w.customer.user._id}`).set(w.customer.headers)
            .send({ notes: 'hack' })).status, 403);
    });
});

describe('owner: a rider email', () => {
    test('the owner sets and clears a rider email, and the list shows it', async () => {
        const w = await f.makeWorld('rider-email');
        const url = `/api/shop/riders/${w.rider.user._id}`;
        const set = await request(app).patch(url).set(w.owner.headers).send({ email: 'Ravi@Mail.test' });
        assert.equal(set.status, 200);
        assert.equal((await User.findById(w.rider.user._id).lean()).email, 'ravi@mail.test');
        const list = await request(app).get('/api/shop/riders').set(w.owner.headers);
        assert.equal(list.body.items[0].email, 'ravi@mail.test');
        assert.equal((await request(app).patch(url).set(w.owner.headers).send({ email: 'bad' })).status, 400);
        assert.equal((await request(app).patch(url).set(w.owner.headers).send({ email: '' })).status, 200);
        assert.equal((await User.findById(w.rider.user._id).lean()).email, undefined);
    });
});