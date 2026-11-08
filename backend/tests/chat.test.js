require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const BulkOrder = require('../src/models/BulkOrder');
const ServiceInquiry = require('../src/models/ServiceInquiry');
const TableBooking = require('../src/models/TableBooking');
const ChatMessage = require('../src/models/ChatMessage');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');
const realtime = require('../src/services/realtime');
const storage = require('../src/services/adapters/storage');

// The chat between a customer and the owner (like WhatsApp): ticks (sent, delivered, read), live messages, pictures, voice notes, typing,
// unread counts, and a chat that closes by itself.
const days = (k) => new Date(Date.now() + k * 86400000).toISOString();
const PIC = 'https://files.example.com/chats/2026-11/pic1.webp';
const VOICE = 'https://files.example.com/chats/2026-11/voice1.m4a';

describe('the chat of a bulk order', () => {
    let w; let id; let live; let other;
    const cust = (m, p, b, h = w.customer.headers) => request(app)[m](`/api/chat/bulk/${id}${p}`).set(h).send(b);
    const owner = (m, p, b) => request(app)[m](`/api/shop/chat/bulk/${id}${p}`).set(w.owner.headers).send(b);
    const mine = async (headers = w.customer.headers) => (await request(app).get(`/api/chat/bulk/${id}`).set(headers)).body;

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        live = [];
        mock.method(realtime, 'toOwner', (t, ev, p) => live.push(['owner', ev, p]));
        mock.method(realtime, 'toUser', (t, u, ev, p) => live.push(['user:' + u, ev, p]));
        w = await f.makeWorld(`chat-${Date.now()}`);
        other = await f.makeUser(w.tenant, 'customer', '9000000099');
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        const dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        await request(app).put('/api/shop/bulk/settings').set(w.owner.headers).send({ enabled: true, noticeHours: 1 });
        const r = await request(app).post('/api/bulk').set(w.customer.headers).send({ fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        id = r.body.id;
    });
    afterEach(() => mock.restoreAll());

    test('a message goes to the other person live, with one tick; the customer sees it as sent', async () => {
        const r = await cust('post', '', { text: 'Can you make it less spicy?', clientId: 'c1' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual([r.body.mine, r.body.status, r.body.text], [true, 'sent', 'Can you make it less spicy?']);
        const toOwner = live.find((x) => x[0] === 'owner' && x[1] === 'chat:message');
        assert.equal(toOwner[2].message.mine, false);                      // for him it is the other person's
        assert.equal(toOwner[2].message.status, undefined);
        assert.ok(live.some((x) => x[0] === 'user:' + w.customer.user._id && x[1] === 'chat:message' && x[2].echo), 'my other phone gets it too');
        const seen = (await request(app).get(`/api/shop/chat/bulk/${id}`).set(w.owner.headers)).body;
        assert.deepEqual(seen.items.map((m) => [m.mine, m.text]), [[false, 'Can you make it less spicy?']]);
    });

    test('the ticks: sent, then delivered when his app has it, then read when he opens the chat', async () => {
        const sent = (await cust('post', '', { text: 'Hello' })).body;
        assert.equal((await mine()).items[0].status, 'sent');
        // his phone got it (the app tells the server)
        await owner('post', '/ack', { ids: [sent.id] });
        assert.equal((await mine()).items[0].status, 'delivered');
        assert.ok(live.some((x) => x[0] === 'user:' + w.customer.user._id && x[1] === 'chat:status' && x[2].status === 'delivered'), 'the customer is told live');
        // he opens the chat
        await owner('get', '?read=1');
        const after = (await mine()).items[0];
        assert.equal(after.status, 'read');
        assert.ok(live.some((x) => x[1] === 'chat:status' && x[2].status === 'read'));
        // the other way round
        const back = (await owner('post', '', { text: 'Yes, of course' })).body;
        assert.equal(back.status, 'sent');
        await cust('get', '?read=1');
        const ownerSide = (await owner('get', '')).body.items.find((m) => m.mine);
        assert.equal(ownerSide.status, 'read');
    });

    test('just fetching the chat means it reached his phone (delivered), but not that he read it', async () => {
        await cust('post', '', { text: 'Hello' });
        await owner('get', '');                                           // no read=1
        assert.equal((await mine()).items[0].status, 'delivered');
    });

    test('the same message sent twice (a bad connection) is saved once', async () => {
        const a = await cust('post', '', { text: 'One', clientId: 'same-1' });
        const b = await cust('post', '', { text: 'One', clientId: 'same-1' });
        assert.equal(a.body.id, b.body.id);
        assert.equal(await ChatMessage.countDocuments({ refId: id }), 1);
    });

    describe('deleting a message', () => {
        const del = (who, mid, scope) => (who === 'owner'
            ? request(app).delete(`/api/shop/chat/bulk/${id}/messages/${mid}`).query({ scope }).set(w.owner.headers)
            : request(app).delete(`/api/chat/bulk/${id}/messages/${mid}`).query({ scope }).set(w.customer.headers));
        const ownerView = async () => (await request(app).get(`/api/shop/chat/bulk/${id}`).set(w.owner.headers)).body.items;

        test('delete for me: gone for me only, any message; the other person still has it', async () => {
            const a = (await cust('post', '', { text: 'from customer' })).body;
            const b = (await owner('post', '', { text: 'from owner' })).body;
            assert.equal((await del('customer', b.id, 'me')).status, 200);   // the customer hides the OWNER's message
            assert.deepEqual((await mine()).items.map((x) => x.text), ['from customer']);
            assert.deepEqual((await ownerView()).map((x) => x.text), ['from customer', 'from owner']);
            assert.equal((await del('customer', a.id, 'me')).status, 200);   // and his own
            assert.equal((await mine()).items.length, 0);
            assert.equal((await ownerView()).length, 2, 'the owner still sees both');
            assert.equal((await del('customer', b.id, 'me')).status, 404, 'it is already gone for him');
        });

        test('delete for everyone: the words, picture and voice are removed for both; a note stays; both phones are told live', async () => {
            const m = (await cust('post', '', { text: 'a secret', images: [PIC] })).body;
            live.length = 0;
            const r = await del('customer', m.id, 'all');
            assert.equal(r.status, 200);
            assert.deepEqual(r.body, { ok: true, id: m.id, scope: 'all' });
            const row = await ChatMessage.findById(m.id).lean();
            assert.equal(row.text, '');
            assert.equal(row.images, undefined);
            assert.equal(row.deletedAll, true);
            const o = (await ownerView()).find((x) => x.id === m.id);
            assert.equal(o.deleted, true);
            assert.deepEqual([o.text, o.images, o.voice], ['', [], null]);
            const c = (await mine()).items.find((x) => x.id === m.id);
            assert.equal(c.deleted, true);
            assert.equal(c.mine, true);
            const told = live.filter(([, ev]) => ev === 'chat:deleted');
            assert.ok(told.some(([to]) => to === 'owner'), 'the owner is told');
            assert.ok(told.some(([to]) => to === 'user:' + w.customer.user._id), 'his other phone is told');
            assert.deepEqual(told[0][2].ids, [m.id]);
            assert.equal((await del('customer', m.id, 'all')).status, 200, 'doing it twice is fine');
        });

        test('the rules: own message only, while the chat is open, within 2 days, a good scope, and only the two people of the chat', async () => {
            const a = (await cust('post', '', { text: 'mine' })).body;
            assert.equal((await del('owner', a.id, 'all')).status, 403, 'the owner cannot delete the customer message for everyone');
            assert.equal((await del('owner', a.id, 'me')).status, 200, 'but he can hide it for himself');
            assert.equal((await del('customer', a.id, 'sideways')).status, 400);
            assert.equal((await request(app).delete(`/api/chat/bulk/${id}/messages/${a.id}`).query({ scope: 'me' }).set(other.headers)).status, 404, 'a stranger');
            assert.equal((await del('customer', '000000000000000000000000', 'me')).status, 404);

            const old = (await cust('post', '', { text: 'old one' })).body;
            await ChatMessage.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(old.id) }, { $set: { createdAt: new Date(Date.now() - 3 * 86400000) } });
            const tooOld = await del('customer', old.id, 'all');
            assert.equal(tooOld.status, 409);
            assert.match(tooOld.body.error, /too old/);
            assert.equal((await del('customer', old.id, 'me')).status, 200, 'for me there is no age limit');

            const late = (await cust('post', '', { text: 'before it closed' })).body;
            await BulkOrder.updateOne({ _id: id }, { $set: { status: 'completed', completedAt: new Date(Date.now() - 5 * 86400000) } });
            assert.equal((await mine()).closed, true);
            const closed = await del('customer', late.id, 'all');
            assert.equal(closed.status, 409, 'a closed chat cannot be written to');
            assert.equal((await del('customer', late.id, 'me')).status, 200, 'but you can still tidy it for yourself');
        });

        test('an unread message that is deleted leaves the badge', async () => {
            const b = (await owner('post', '', { text: 'for him' })).body;
            assert.equal((await request(app).get('/api/chat/unread').set(w.customer.headers)).body.total, 1);
            await del('customer', b.id, 'me');
            assert.equal((await request(app).get('/api/chat/unread').set(w.customer.headers)).body.total, 0);

            const a = (await cust('post', '', { text: 'for the owner' })).body;
            assert.equal((await request(app).get('/api/shop/chat/unread').set(w.owner.headers)).body.total, 1);
            await del('customer', a.id, 'all');
            assert.equal((await request(app).get('/api/shop/chat/unread').set(w.owner.headers)).body.total, 0, 'deleted for everyone: the owner has nothing to read');
        });
    });

    test('the sender gets his own clientId back (so his phone swaps its "sending" bubble for the real one, no twin); the other side never sees it', async () => {
        const r = await cust('post', '', { text: 'Matching', clientId: 'mine-77' });
        assert.equal(r.body.clientId, 'mine-77');
        const seen = (await request(app).get(`/api/shop/chat/bulk/${id}`).set(w.owner.headers)).body;
        const m = seen.items.find((x) => x.text === 'Matching');
        assert.ok(m && m.clientId === undefined, 'the owner does not get the customer clientId');
        const mineAgain = (await request(app).get(`/api/chat/bulk/${id}`).set(w.customer.headers)).body;
        assert.equal(mineAgain.items.find((x) => x.text === 'Matching').clientId, 'mine-77');
    });

    test('pictures and voice notes; an empty message or a bad address is refused', async () => {
        const p = await cust('post', '', { images: [PIC, 'not a url', PIC.replace('pic1', 'pic2')] });
        assert.equal(p.status, 201);
        assert.deepEqual(p.body.images.length, 2, 'the bad address is dropped');
        const v = await owner('post', '', { voice: { url: VOICE, sec: 12 } });
        assert.equal(v.status, 201);
        assert.deepEqual([v.body.voice.url, v.body.voice.sec], [VOICE, 12]);
        assert.equal((await cust('post', '', { text: '   ' })).status, 400);
        assert.equal((await cust('post', '', { voice: { url: 'javascript:alert(1)', sec: 3 } })).status, 400);
    });

    test('only the customer of the order and the owner can open it', async () => {
        await cust('post', '', { text: 'private' });
        assert.equal((await request(app).get(`/api/chat/bulk/${id}`).set(other.headers)).status, 404);
        assert.equal((await request(app).post(`/api/chat/bulk/${id}`).set(other.headers).send({ text: 'hi' })).status, 404);
        assert.equal((await request(app).get(`/api/chat/bulk/${id}`).set('x-tenant-slug', w.tenant.slug)).status, 401);
        assert.equal((await request(app).get('/api/chat/bulk/not-an-id').set(w.customer.headers)).status, 404);
        assert.equal((await request(app).get(`/api/chat/nothing/${id}`).set(w.customer.headers)).status, 404);
    });

    test('unread counts for the badges, per chat, for each side', async () => {
        await cust('post', '', { text: 'a' }); await cust('post', '', { text: 'b' });
        assert.deepEqual((await request(app).get('/api/shop/chat/unread').set(w.owner.headers)).body, { total: 2, byRef: { [`bulk:${id}`]: 2 } });
        assert.equal((await request(app).get('/api/chat/unread').set(w.customer.headers)).body.total, 0);
        await owner('post', '', { text: 'c' });
        assert.equal((await request(app).get('/api/chat/unread').set(w.customer.headers)).body.total, 1);
        assert.equal((await request(app).get('/api/chat/unread').set(other.headers)).body.total, 0, 'someone else sees none');
        await owner('get', '?read=1');
        assert.equal((await request(app).get('/api/shop/chat/unread').set(w.owner.headers)).body.total, 0);
    });

    test('the owner gets ONE notification for a burst of messages, and it opens the chat', async () => {
        await cust('post', '', { text: 'first' }); await cust('post', '', { text: 'second' }); await cust('post', '', { text: 'third' });
        const ns = await Notification.find({ type: 'chat_message' }).lean();
        assert.equal(ns.length, 1);
        assert.equal(ns[0].title, 'New message from Raj');
        assert.deepEqual([ns[0].data.kind, ns[0].data.chatKind, String(ns[0].data.refId)], ['chat', 'bulk', String(id)]);
        await owner('post', '', { text: 'reply' });
        const toCustomer = await Notification.findOne({ type: 'chat_message', userId: w.customer.user._id }).lean();
        assert.ok(toCustomer, 'the customer is told too');
        assert.equal(toCustomer.data.kind, 'chat');
    });

    test('typing: the other person is told, at most every 1.5 seconds', async () => {
        assert.equal((await cust('post', '/typing', {})).status, 200);
        assert.equal(live.filter((x) => x[1] === 'chat:typing').length, 1);
        await cust('post', '/typing', {});
        assert.equal(live.filter((x) => x[1] === 'chat:typing').length, 1, 'too soon: not repeated');
    });

    test('a chat closes 3 days after the bulk order ends: it can be read, not written to', async () => {
        await cust('post', '', { text: 'before' });
        assert.equal((await mine()).closed, false);
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'cancelled', updatedAt: new Date(Date.now() - 2 * 86400000) } }, { timestamps: false });
        assert.equal((await mine()).closed, false, '2 days after: still open');
        assert.equal((await cust('post', '', { text: 'still ok' })).status, 201);
        await BulkOrder.updateOne({ _id: id }, { $set: { updatedAt: new Date(Date.now() - 4 * 86400000) } }, { timestamps: false });
        const late = await mine();
        assert.equal(late.closed, true);
        assert.equal(late.items.length, 2, 'it can still be read');
        const r = await cust('post', '', { text: 'too late' });
        assert.equal(r.status, 409, JSON.stringify(r.body));
        assert.match(r.body.error, /closed/);
        assert.equal((await owner('post', '', { text: 'me too' })).status, 409);
    });
});

describe('the chat of an inquiry and of a table booking', () => {
    let w; let other;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        mock.method(realtime, 'toOwner', () => { });
        mock.method(realtime, 'toUser', () => { });
        w = await f.makeWorld(`chatib-${Date.now()}`);
        other = await f.makeUser(w.tenant, 'customer', '9000000098');
    });
    afterEach(() => mock.restoreAll());
    const inq = (o = {}) => ServiceInquiry.create({ tenantId: w.tenant._id, serviceId: new (require('mongoose').Types.ObjectId)(), serviceName: 'Tiffin', userId: w.customer.user._id, name: 'Asha', phone: '9000000030', ...o });
    const bk = (o = {}) => TableBooking.create({ tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Asha', phone: '9000000030', date: '2026-11-20', time: '20:00', party: 2, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), status: 'confirmed', ...o });

    test('an inquiry chat: both talk, old words show first as read, the list badge follows, the owner ending it closes the chat', async () => {
        const i = await inq({ messages: [{ from: 'customer', text: 'Old question' }, { from: 'owner', text: 'Old answer' }] });
        const r = await request(app).post(`/api/chat/inquiry/${i._id}`).set(w.customer.headers).send({ text: 'New question' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal((await ServiceInquiry.findById(i._id).lean()).ownerUnread, 1);
        const seen = (await request(app).get(`/api/shop/chat/inquiry/${i._id}?read=1`).set(w.owner.headers)).body;
        assert.deepEqual(seen.items.map((m) => m.text), ['Old question', 'Old answer', 'New question']);
        assert.equal(seen.closed, false);
        assert.equal((await ServiceInquiry.findById(i._id).lean()).ownerUnread, 0);
        assert.equal((await request(app).post(`/api/shop/chat/inquiry/${i._id}`).set(w.owner.headers).send({ text: 'Yes we can' })).status, 201);
        assert.equal((await request(app).get(`/api/chat/inquiry/${i._id}`).set(other.headers)).status, 404);
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { status: 'closed' } });
        const late = await request(app).post(`/api/chat/inquiry/${i._id}`).set(w.customer.headers).send({ text: 'hello?' });
        assert.equal(late.status, 409);
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { status: 'replied' } });
        assert.equal((await request(app).post(`/api/chat/inquiry/${i._id}`).set(w.customer.headers).send({ text: 'hello?' })).status, 201, 'opened again');
    });

    test('a booking chat: open until 3 days after the booking, and for a cancelled booking 3 days after it was cancelled', async () => {
        const b = await bk();
        assert.equal((await request(app).post(`/api/chat/booking/${b._id}`).set(w.customer.headers).send({ text: 'Window seat?' })).status, 201);
        assert.equal((await request(app).post(`/api/shop/chat/booking/${b._id}`).set(w.owner.headers).send({ text: 'Yes' })).status, 201);
        assert.equal((await request(app).get(`/api/chat/booking/${b._id}`).set(other.headers)).status, 404);
        const old = await bk({ code: 'ZZZZZ', startsAt: new Date(Date.now() - 5 * 86400000), endsAt: new Date(Date.now() - 5 * 86400000 + 3600000) });
        const g = await request(app).get(`/api/chat/booking/${old._id}`).set(w.customer.headers);
        assert.equal(g.body.closed, true);
        assert.equal((await request(app).post(`/api/chat/booking/${old._id}`).set(w.customer.headers).send({ text: 'x' })).status, 409);
    });
});

describe('uploads for a chat', () => {
    let w;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); w = await f.makeWorld(`chatup-${Date.now()}`); mock.method(storage, 'presignPut', async () => 'https://upload.test/file'); });
    afterEach(() => mock.restoreAll());
    const sign = (headers, path, body) => request(app).post(path).set(headers).send(body);

    test('a customer and the owner can sign a chat picture and a voice note; the wrong type or size is refused', async () => {
        for (const [headers, path] of [[w.customer.headers, '/api/me/uploads/sign'], [w.owner.headers, '/api/shop/uploads/sign']]) {
            const pic = await sign(headers, path, { kind: 'chat', contentType: 'image/jpeg', bytes: 200000 });
            assert.equal(pic.status, 200, JSON.stringify(pic.body));
            const voice = await sign(headers, path, { kind: 'chatvoice', contentType: 'audio/mp4', bytes: 90000 });
            assert.equal(voice.status, 200, JSON.stringify(voice.body));
            assert.match(voice.body.key, /\.m4a$/);
            assert.equal((await sign(headers, path, { kind: 'chatvoice', contentType: 'image/jpeg', bytes: 1000 })).status, 400, 'a voice note is audio');
            assert.equal((await sign(headers, path, { kind: 'chatvoice', contentType: 'audio/mp4', bytes: 2 * 1024 * 1024 })).status, 400, 'too long');
            assert.equal((await sign(headers, path, { kind: 'chat', contentType: 'audio/mp4', bytes: 1000 })).status, 400, 'a picture is an image');
        }
    });
});
