require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld } = require('./helpers/factory');

// The whole conversation: the owner makes a service, the customer sends an inquiry, they write back and forth.
describe('service inquiries', () => {
    let w; let service; let inquiryId;
    before(async () => { await db.connect(); w = await makeWorld('svc-shop'); });
    after(() => db.disconnect());

    test('the owner makes a service from a starter and one of his own', async () => {
        const a = await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'bulk', price: 1000 });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.equal(a.body.name, 'Bulk Order Booking');
        assert.ok(a.body.questions.length >= 5);
        service = a.body;
        const b = await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'custom', name: 'Cake order' });
        assert.equal(b.status, 201);
        assert.equal(b.body.name, 'Cake order');
        const list = await request(app).get('/api/shop/services').set(w.owner.headers);
        assert.equal(list.body.items.length, 2);
    });

    test('a customer cannot touch the owner routes', async () => {
        const r = await request(app).get('/api/shop/services').set(w.customer.headers);
        assert.ok([401, 403].includes(r.status), String(r.status));
    });

    test('a switched-off service is hidden from customers', async () => {
        const off = await request(app).patch(`/api/shop/services/${service._id}`).set(w.owner.headers).send({ isActive: false });
        assert.equal(off.body.isActive, false);
        assert.equal((await request(app).get('/api/services').set(w.customer.headers)).body.items.length, 1);
        await request(app).patch(`/api/shop/services/${service._id}`).set(w.owner.headers).send({ isActive: true });
        assert.equal((await request(app).get('/api/services').set(w.customer.headers)).body.items.length, 2);
    });

    test('the customer sends an inquiry; a missing required answer is refused', async () => {
        const bad = await request(app).post(`/api/services/${service._id}/inquiries`).set(w.customer.headers).send({ name: 'Anil', phone: '9000000030', answers: { function: 'Wedding', guests: 30 } });
        assert.equal(bad.status, 400);
        const ok = await request(app).post(`/api/services/${service._id}/inquiries`).set(w.customer.headers)
            .send({ name: 'Anil', phone: '9000000030', message: 'Need a quote', answers: { function: 'Wedding', date: '2026-11-20', guests: 30, diet: 'Veg' } });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        inquiryId = ok.body.id;
    });

    test('the owner sees it unread, opens it, and replies', async () => {
        const list = await request(app).get('/api/shop/inquiries').set(w.owner.headers);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.unread, 1);
        assert.equal(list.body.counts.new, 1);
        const one = await request(app).get(`/api/shop/inquiries/${inquiryId}`).set(w.owner.headers);
        assert.equal(one.body.estimate, 30000);
        assert.equal(one.body.messages[0].text, 'Need a quote');
        assert.ok(Array.isArray(one.body.quickReplies));
        assert.equal((await request(app).get('/api/shop/inquiries').set(w.owner.headers)).body.unread, 0);
        const rep = await request(app).post(`/api/shop/inquiries/${inquiryId}/reply`).set(w.owner.headers).send({ text: 'Yes, ₹1000 per plate' });
        assert.equal(rep.body.status, 'replied');
        assert.equal(rep.body.messages.length, 2);
        assert.equal((await request(app).post(`/api/shop/inquiries/${inquiryId}/reply`).set(w.owner.headers).send({ text: ' ' })).status, 400);
    });

    test('the customer reads the reply (and not the private note), then writes again', async () => {
        await request(app).patch(`/api/shop/inquiries/${inquiryId}`).set(w.owner.headers).send({ note: 'ring him Friday', status: 'quoted' });
        const mine = await request(app).get('/api/services/inquiries/mine').set(w.customer.headers);
        assert.equal(mine.body.items[0].customerUnread, 1);
        const one = await request(app).get(`/api/services/inquiries/${inquiryId}`).set(w.customer.headers);
        assert.equal(one.body.status, 'quoted');
        assert.equal(one.body.note, undefined);
        assert.equal(one.body.messages.length, 2);
        const more = await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ text: 'Please confirm for 20 Nov' });
        assert.equal(more.status, 200);
        const owner = await request(app).get('/api/shop/inquiries').set(w.owner.headers);
        assert.equal(owner.body.unread, 1);
    });

    test('pictures go both ways (https only, at most 3), and the owner can end the conversation and open it again', async () => {
        const pic = (n) => `https://cdn.example.com/inquiries/${n}.jpg`;
        const rep = await request(app).post(`/api/shop/inquiries/${inquiryId}/reply`).set(w.owner.headers).send({ images: [pic(1), 'http://insecure/x.jpg', pic(2), pic(3), pic(4)] });
        assert.equal(rep.status, 200);
        assert.deepEqual(rep.body.messages[rep.body.messages.length - 1].images, [pic(1), pic(2), pic(3)]);
        const more = await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ images: [pic(5)] });
        assert.equal(more.status, 200);
        assert.equal((await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ images: ['ftp://nope'] })).status, 400);   // nothing valid to send
        await request(app).patch(`/api/shop/inquiries/${inquiryId}`).set(w.owner.headers).send({ status: 'closed' });
        assert.equal((await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ text: 'hi' })).status, 400);
        await request(app).patch(`/api/shop/inquiries/${inquiryId}`).set(w.owner.headers).send({ status: 'replied' });
        assert.equal((await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ text: 'hi again' })).status, 200);
    });

    test('another customer cannot open this inquiry', async () => {
        const { makeUser } = require('./helpers/factory');
        const other = await makeUser(w.tenant, 'customer', '9000000099');
        assert.equal((await request(app).get(`/api/services/inquiries/${inquiryId}`).set(other.headers)).status, 404);
    });

    test('a closed inquiry takes no more messages', async () => {
        await request(app).patch(`/api/shop/inquiries/${inquiryId}`).set(w.owner.headers).send({ status: 'closed' });
        assert.equal((await request(app).post(`/api/services/inquiries/${inquiryId}/messages`).set(w.customer.headers).send({ text: 'hello?' })).status, 400);
    });
});
