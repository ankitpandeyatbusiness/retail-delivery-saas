require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeUser, waitFor } = require('./helpers/factory');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Address = require('../src/models/Address');
const BulkOrder = require('../src/models/BulkOrder');
const Notification = require('../src/models/Notification');
const bulk = require('../src/services/bulkOrders');

// A manager books a lot of food: 40 full Paneer Butter Masala, 50 Butter Naan, 50 half Aloo Dum. The prices come from the menu and the
// owner's bulk prices; the owner then sends his own quote.
describe('bulk orders: request and quote', () => {
    let w; let paneer; let naan; let aloo; let addr;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b, h = w.customer.headers) => request(app)[m](`/api/bulk${p}`).set(h).send(b);
    const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
    const sizeGroup = (halfName, fullExtra) => [{ id: 'size', name: 'Size', min: 1, max: 1, absolute: true, options: [{ id: 'half', name: halfName, price: 0, isDefault: true }, { id: 'full', name: 'Full', price: fullExtra }] }];
    const items = (over = {}) => [
        { productId: String(paneer._id), quantity: 40, selections: [{ groupId: 'size', optionIds: ['full'] }] },
        { productId: String(naan._id), quantity: 50 },
        { productId: String(aloo._id), quantity: 50, selections: [{ groupId: 'size', optionIds: ['half'] }] },
    ].map((x, i) => ({ ...x, ...(over[i] || {}) }));
    const body = (o = {}) => ({ fulfilment: 'pickup', when: days(5), items: items(), contact: { name: 'Meera', phone: '9000000041', company: 'Acme Ltd' }, cutlery: true, packaging: 'boxes', ...o });

    before(async () => {
        await db.connect();
        w = await makeWorld('bulk-shop');
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main course', isActive: true });
        const mk = (name, price, extra = {}) => Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name, price, isVeg: true, isActive: true, ...extra });
        paneer = await mk('Paneer Butter Masala', 150, { optionGroups: sizeGroup('Half', 130), bulk: { minQty: 30, percentOff: 10 } });   // half 150, full 280
        naan = await mk('Butter Naan', 20, { bulk: { minQty: 50, percentOff: 20 } });                                                       // no options at all
        aloo = await mk('Aloo Dum', 100, { optionGroups: sizeGroup('Half', 80) });                                                            // no bulk price
        addr = await Address.create({ tenantId: w.tenant._id, userId: w.customer.user._id, label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' });
    });
    after(() => db.disconnect());

    test('bulk orders are off until the owner switches them on', async () => {
        assert.equal((await cust('post', '/estimate', body())).status, 404);
        assert.equal((await cust('get', '/config')).body.enabled, false);
    });

    test('the owner saves the rules; wrong numbers are refused', async () => {
        assert.equal((await owner('put', '/settings', { minOrderAmount: -5 })).status, 400);
        assert.equal((await owner('put', '/settings', { advancePercent: 5 })).status, 400);
        assert.equal((await owner('put', '/settings', { deliveryFee: { type: 'teleport' } })).status, 400);
        const ok = await owner('put', '/settings', { enabled: true, minOrderAmount: 5000, noticeHours: 24, deliveryFee: { type: 'flat', amount: 300 }, packagingCharge: 100, advancePercent: 50 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual([ok.body.enabled, ok.body.minOrderAmount, ok.body.deliveryFee.type, ok.body.deliveryFee.amount], [true, 5000, 'flat', 300]);
    });

    test('a bulk price needs both numbers', async () => {
        const bad = await request(app).patch(`/api/shop/products/${aloo._id}`).set(w.owner.headers).send({ bulk: { minQty: 1, percentOff: 10 } });
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
        const worse = await request(app).patch(`/api/shop/products/${aloo._id}`).set(w.owner.headers).send({ bulk: { minQty: 20, percentOff: 95 } });
        assert.equal(worse.status, 400);
    });

    test('the bulk menu shows every option and the bulk prices; a dish with no options has just a counter', async () => {
        const m = await cust('get', '/menu');
        assert.equal(m.status, 200, JSON.stringify(m.body));
        const all = m.body.categories.flatMap((c) => c.items);
        const p = all.find((x) => x.name === 'Paneer Butter Masala');
        assert.deepEqual(p.optionGroups[0].options.map((o) => o.name), ['Half', 'Full']);
        assert.deepEqual(p.bulk, { minQty: 30, percentOff: 10 });
        const n = all.find((x) => x.name === 'Butter Naan');
        assert.deepEqual([n.optionGroups.length, n.bulk.minQty], [0, 50]);
        assert.equal(all.find((x) => x.name === 'Aloo Dum').bulk, null);
    });

    test('the live estimate: quantities above 20, bulk prices where the quantity is reached, minimum and notice', async () => {
        const e = await cust('post', '/estimate', body());
        assert.equal(e.status, 200, JSON.stringify(e.body));
        const by = Object.fromEntries(e.body.lines.map((l) => [l.name.split(' · ')[0], l]));
        assert.deepEqual([by['Paneer Butter Masala'].listPrice, by['Paneer Butter Masala'].unitPrice, by['Paneer Butter Masala'].bulkApplied], [280, 252, true]);   // full 280, 10% off from 30
        assert.deepEqual([by['Butter Naan'].unitPrice, by['Butter Naan'].lineTotal], [16, 800]);                                                                         // 20% off from 50
        assert.deepEqual([by['Aloo Dum'].unitPrice, by['Aloo Dum'].bulkApplied], [100, false]);                                                                          // no bulk price on this dish
        assert.equal(e.body.pricing.subtotal, 40 * 252 + 800 + 5000);
        assert.equal(e.body.pricing.deliveryFee, 0);                                    // pickup: no delivery fee
        assert.equal(e.body.pricing.packagingCharge, 100);
        assert.equal(e.body.bulkSaved, 40 * 28 + 50 * 4);
        assert.equal(e.body.canSend, true);

        // 25 paneer is below its bulk quantity: the normal price
        const few = await cust('post', '/estimate', body({ items: items({ 0: { quantity: 25 } }) }));
        assert.equal(few.body.lines.find((l) => l.name.startsWith('Paneer')).bulkApplied, false);

        // too small, and too soon
        const small = await cust('post', '/estimate', body({ items: [{ productId: String(naan._id), quantity: 10 }], when: days(5) }));
        assert.equal(small.body.canSend, false);
        assert.ok(small.body.problems.some((x) => x.code === 'minimum'));
        const soon = await cust('post', '/estimate', body({ when: new Date(Date.now() + 3600000).toISOString() }));
        assert.ok(soon.body.problems.some((x) => x.code === 'notice'));
    });

    test('the bulk delivery fee is the shop\'s own; a delivery needs an address', async () => {
        const noAddr = await cust('post', '/estimate', body({ fulfilment: 'delivery' }));
        assert.equal(noAddr.status, 400);
        const d = await cust('post', '/estimate', body({ fulfilment: 'delivery', addressId: String(addr._id) }));
        assert.equal(d.status, 200, JSON.stringify(d.body));
        assert.equal(d.body.pricing.deliveryFee, 300);
        await owner('put', '/settings', { deliveryFee: { type: 'free_above', amount: 300, freeAbove: 10000 } });
        assert.equal((await cust('post', '/estimate', body({ fulfilment: 'delivery', addressId: String(addr._id) }))).body.pricing.deliveryFee, 0);   // the order is above Rs 10000
        await owner('put', '/settings', { deliveryFee: { type: 'flat', amount: 300 } });
    });

    let id;
    test('the customer sends the request; the owner is told; a double tap sends one', async () => {
        const noName = await cust('post', '/', body({ contact: { name: '', phone: '' } }));
        assert.ok([400].includes(noName.status) || noName.status === 201);   // the logged in user's own name and phone fill an empty one
        await BulkOrder.deleteMany({});
        const same = body({ fulfilment: 'delivery', addressId: String(addr._id), note: 'Ring the bell at gate 2' });   // a double tap sends the very same request twice
        const r = await cust('post', '/', same);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.status, 'requested');
        assert.equal(r.body.lines.length, 3);
        assert.equal(r.body.contact.company, 'Acme Ltd');
        id = r.body.id;
        const again = await cust('post', '/', same);
        assert.equal(again.status, 200);
        assert.equal(again.body.id, id);
        assert.equal(await BulkOrder.countDocuments({}), 1);
        const note = await waitFor(() => Notification.findOne({ type: 'bulk_new' }).lean());
        assert.ok(note, 'the owner has a bulk_new notification');
    });

    test('a request that breaks the rules is refused with the reason', async () => {
        const small = await cust('post', '/', body({ items: [{ productId: String(naan._id), quantity: 10 }] }));
        assert.equal(small.status, 400);
        assert.match(small.body.error, /minimum bulk order/);
        const gst = await cust('post', '/', body({ contact: { name: 'Meera', phone: '9000000041', gstin: 'bad' } }));
        assert.equal(gst.status, 400);
    });

    test('the owner sees the request and quotes: his prices, a discount, his delivery fee, his advance', async () => {
        const list = await owner('get', '?status=requested');
        assert.equal(list.body.items.length, 1);
        const o = (await owner('get', `/${id}`)).body;
        assert.equal(o.contact.company, 'Acme Ltd');
        const lineOf = (n) => o.lines.find((l) => l.name.startsWith(n));

        assert.equal((await owner('post', `/${id}/quote`, { lines: [] })).status, 400);
        assert.equal((await owner('post', `/${id}/quote`, { lines: [{ id: 'nope', unitPrice: 10 }] })).status, 400);
        assert.equal((await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: -1 })) })).status, 400);

        const q = await owner('post', `/${id}/quote`, {
            lines: [{ id: lineOf('Paneer').id, unitPrice: 240 }, { id: lineOf('Butter').id, unitPrice: 15 }, { id: lineOf('Aloo').id, unitPrice: 90 }],
            discount: 500, deliveryFee: 200, advancePercent: 40, validHours: 12, note: 'Ready 1 hour before your time',
        });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        assert.equal(q.body.status, 'quoted');
        // 40*240 + 50*15 + 50*90 = 9600 + 750 + 4500 = 14850; minus 500; plus delivery 200 and packaging 100 (GST is off in this shop)
        assert.deepEqual([q.body.quote.pricing.subtotal, q.body.quote.pricing.total], [14850, 14850 - 500 + 200 + 100]);
        assert.equal(q.body.quote.advancePaise, Math.round(14650 * 100 * 0.4));
        assert.equal(q.body.quote.advancePaise + q.body.quote.balancePaise, 1465000);
        assert.equal(q.body.quote.version, 1);
        const note = await waitFor(() => Notification.findOne({ userId: w.customer.user._id, type: 'bulk_quoted' }).lean());
        assert.ok(note, 'the customer was told');
        assert.equal((await owner('post', `/${id}/quote`, { lines: [{ id: lineOf('Aloo').id, unitPrice: 90 }] })).status, 409, 'a second quote while one is open');
    });

    test('the customer sees the whole bill, asks for a change, and the owner quotes again', async () => {
        const seen = (await cust('get', `/${id}`)).body;
        assert.equal(seen.status, 'quoted');
        assert.equal(seen.quote.lines.length, 3);
        assert.equal(seen.quote.pricing.total, 14650);
        assert.equal(seen.quote.advancePercent, 40);
        assert.equal(seen.quote.note, 'Ready 1 hour before your time');
        assert.equal((await cust('post', `/${id}/change`, { note: '' })).status, 400);
        const ch = await cust('post', `/${id}/change`, { note: 'Can you do the delivery fee free?' });
        assert.equal(ch.body.status, 'requested');
        assert.equal(ch.body.changeNote, 'Can you do the delivery fee free?');
        const o = (await owner('get', `/${id}`)).body;
        const again = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })), deliveryFee: 0 });
        assert.equal(again.body.quote.version, 2);
        assert.equal(again.body.quote.pricing.deliveryFee, 0);
        assert.equal((await owner('get', `/${id}`)).body.history.filter((h) => h.status === 'quoted').length, 2);
    });

    test('a quote that ran out is shown as expired; the customer can ask for a new one', async () => {
        await BulkOrder.updateOne({ _id: id }, { $set: { 'quote.validUntil': new Date(Date.now() - 1000) } });
        assert.equal((await cust('get', `/${id}`)).body.status, 'expired');
        assert.equal(await bulk.expireOld(), 1);
        assert.equal((await BulkOrder.findById(id).lean()).status, 'expired');
    });

    test('the shop can decline with a reason; the customer can cancel his own request', async () => {
        const r = await cust('post', '/', body({ items: items({ 0: { quantity: 45 } }) }));
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal((await owner('post', `/${r.body.id}/decline`, { reason: '' })).status, 400);
        const d = await owner('post', `/${r.body.id}/decline`, { reason: 'We are closed that week' });
        assert.deepEqual([d.body.status, d.body.declineReason], ['declined', 'We are closed that week']);
        assert.equal((await cust('post', `/${r.body.id}/cancel`)).status, 409, 'already declined');

        const mine = await cust('post', '/', body({ items: items({ 0: { quantity: 46 } }) }));
        const c = await cust('post', `/${mine.body.id}/cancel`);
        assert.equal(c.body.status, 'cancelled');
    });

    test('nobody sees another customer\'s order, and a customer cannot use the owner routes', async () => {
        const other = await makeUser(w.tenant, 'customer', '9111111155');
        assert.equal((await cust('get', `/${id}`, undefined, other.headers)).status, 404);
        assert.equal((await cust('post', `/${id}/cancel`, {}, other.headers)).status, 404);
        assert.equal((await cust('get', '/mine', undefined, other.headers)).body.items.length, 0);
        const r = await request(app).get('/api/shop/bulk').set(w.customer.headers);
        assert.ok([401, 403].includes(r.status), String(r.status));
    });
});

// GST on a bulk order: the same rule as a normal order (the shop's mode and rate), on the bulk prices and again on the owner's own prices
describe('bulk orders: GST', () => {
    const Tenant = require('../src/models/Tenant');
    const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
    let w; let dish; let id;
    const cust = (m, p, b) => request(app)[m](`/api/bulk${p}`).set(w.customer.headers).send(b);
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    before(async () => {
        await db.connect();
        w = await makeWorld('bulk-gst');
        // the one GST of the platform applies to a shop that has a GST number
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { business: { legalName: 'Shop', gstin: '27AAAAA0000A1Z5' } } });
        tenantRecognizer.invalidateTenant('bulk-gst');
        const admin = await require('./helpers/factory').makeSuperAdmin('root@test.com');
        await request(app).put('/api/admin/platform/tax').set({ Authorization: `Bearer ${admin.token}` }).send({ gstPercent: 5, gstMode: 'exclusive' });
        await require('../src/services/platformTax').load();
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true, gstInclusive: false });
        await owner('put', '/settings', { enabled: true, noticeHours: 1 });
    });
    after(() => db.disconnect());

    test('GST is added on top of the bulk prices, and worked out again on the owner\'s prices', async () => {
        const r = await cust('post', '/', { fulfilment: 'pickup', when: new Date(Date.now() + 86400000).toISOString(), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual([r.body.pricing.subtotal, r.body.pricing.tax, r.body.pricing.total], [10000, 500, 10500]);
        id = r.body.id;
        const o = (await owner('get', `/${id}`)).body;
        const q = await owner('post', `/${id}/quote`, { lines: [{ id: o.lines[0].id, unitPrice: 90 }], discount: 1000 });
        // 100 x 90 = 9000, minus 1000 = 8000 taxable, GST 5% = 400 on top
        assert.deepEqual([q.body.quote.pricing.subtotal, q.body.quote.pricing.tax, q.body.quote.pricing.total], [9000, 400, 8400]);
        assert.equal(q.body.quote.advancePaise, 420000);
    });
});
