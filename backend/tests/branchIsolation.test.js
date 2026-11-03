require('./helpers/env');
// Phase 8 of the multi-branch plan: one branch must never reach the records of another branch, and one brand never those of another brand.
// The setup: brand Savera has Hyderabad (A) and Mumbai (B). Everything below is made at Mumbai; the people of Hyderabad try to reach it.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeUser, makeOrder, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Coupon = require('../src/models/Coupon');
const Address = require('../src/models/Address');
const BulkOrder = require('../src/models/BulkOrder');
const TableBooking = require('../src/models/TableBooking');
const ServiceInquiry = require('../src/models/ServiceInquiry');
const tokenService = require('../src/services/tokenService');
const riders = require('../src/services/riderService');

let supreme;
const post = (url, body, t = supreme) => request(app).post(url).set({ Authorization: `Bearer ${t}` }).send(body);
// 409 = "not available / already taken": also a refusal (the checks that follow prove nothing changed)
const REFUSED = [400, 403, 404, 409];

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

async function tokenFor(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}
async function newBrand(name, cities, prefix) {
    const brand = (await post('/api/admin/brands', { name, branchLimit: 6 })).body.brand;
    const out = [];
    for (const c of cities) {
        const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `${name} ${c}`, slug: `${prefix}-${c}`, city: c });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        out.push(r.body.branch);
    }
    return { brand, out };
}

// the whole world: who is where, and what Mumbai has
async function world() {
    const { brand, out } = await newBrand('Savera', ['hyderabad', 'mumbai'], 'sav');
    const [hyd, mum] = out;
    const H = await Tenant.findById(hyd.id);
    const M = await Tenant.findById(mum.id);

    // Hyderabad people
    const hCust = await makeUser(H, 'customer', '9811000001');
    const hOwnerPhone = '9811000002';
    await post(`/api/admin/tenants/${H._id}/owners`, { phone: hOwnerPhone });
    await riders.addByPhone({ tenantId: H._id, phone: '9811000003', name: 'Hyd Rider' });
    const people = {
        customer: hCust.accessToken,
        owner: await tokenFor(H._id, hOwnerPhone),
        rider: await tokenFor(H._id, '9811000003'),
    };

    // Mumbai people and records
    const mCust = await makeUser(M, 'customer', '9822000001');
    const cat = await Category.create({ tenantId: M._id, name: 'Mains' });
    const dish = await Product.create({ tenantId: M._id, categoryId: cat._id, name: 'Mumbai Vada Pav', price: 40, isVeg: true });
    const order = await makeOrder(M, mCust.user, { status: 'placed' });
    const addr = await Address.create({ tenantId: M._id, userId: mCust.user._id, label: 'Home', line1: 'Secret street 9', phone: '9822000001', latitude: 19.07, longitude: 72.87 });
    const ids = {
        order: String(order._id), dish: String(dish._id), address: String(addr._id), customer: String(mCust.user._id),
        bulk: String(new mongoose.Types.ObjectId()), booking: String(new mongoose.Types.ObjectId()), inquiry: String(new mongoose.Types.ObjectId()),
    };
    // these have many required fields: written raw, only the owner and the tenant matter for the test
    await BulkOrder.collection.insertOne({ _id: new mongoose.Types.ObjectId(ids.bulk), tenantId: M._id, userId: mCust.user._id, status: 'requested', createdAt: new Date() });
    await TableBooking.collection.insertOne({ _id: new mongoose.Types.ObjectId(ids.booking), tenantId: M._id, userId: mCust.user._id, status: 'confirmed', createdAt: new Date() });
    await ServiceInquiry.collection.insertOne({ _id: new mongoose.Types.ObjectId(ids.inquiry), tenantId: M._id, userId: mCust.user._id, status: 'open', createdAt: new Date() });
    await Coupon.create({ tenantId: M._id, code: 'MUMBAI50', discountType: 'percent', discountValue: 50 });
    return { brand, hyd, mum, H, M, people, ids, mCust, mOwner: await ownerOf(M, '9822000002') };
}
async function ownerOf(tenant, phone) {
    await post(`/api/admin/tenants/${tenant._id}/owners`, { phone });
    return tokenFor(tenant._id, phone);
}
const call = (method, slug, token, path, body) => request(app)[method](path).set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`).send(body || {});

describe('branch isolation: a person of Hyderabad against the records of Mumbai', () => {
    test('control: the real owner and customer of Mumbai CAN reach these records (so the refusals below mean something)', async () => {
        const w = await world();
        assert.equal((await call('get', w.mum.slug, w.mCust.accessToken, `/api/orders/${w.ids.order}`)).status, 200);
        assert.equal((await call('get', w.mum.slug, w.mOwner, `/api/shop/orders/${w.ids.order}`)).status, 200);
        assert.equal((await call('get', w.mum.slug, w.mCust.accessToken, '/api/addresses')).body.length || (await call('get', w.mum.slug, w.mCust.accessToken, '/api/addresses')).body.items?.length, 1);
    });

    test('a Hyderabad customer, with a valid Hyderabad login, cannot reach any Mumbai order, bulk order, booking, inquiry, chat or address by id', async () => {
        const w = await world();
        const t = w.people.customer;
        const probes = [
            ['get', `/api/orders/${w.ids.order}`], ['get', `/api/orders/${w.ids.order}/tracking`], ['get', `/api/orders/${w.ids.order}/invoice`],
            ['get', `/api/orders/${w.ids.order}/rating`], ['get', `/api/orders/${w.ids.order}/complaints`], ['get', `/api/orders/${w.ids.order}/cancel-preview`],
            ['post', `/api/orders/${w.ids.order}/cancel`], ['post', `/api/orders/${w.ids.order}/rating`, { stars: 1 }], ['post', `/api/orders/${w.ids.order}/reorder`],
            ['post', `/api/orders/${w.ids.order}/pay`], ['post', `/api/orders/${w.ids.order}/complaints`, { text: 'x' }],
            ['get', `/api/bulk/${w.ids.bulk}`], ['get', `/api/bulk/${w.ids.bulk}/invoice`], ['post', `/api/bulk/${w.ids.bulk}/cancel`], ['post', `/api/bulk/${w.ids.bulk}/pay`],
            ['get', `/api/bookings/${w.ids.booking}/ticket`], ['get', `/api/bookings/${w.ids.booking}/receipt`], ['post', `/api/bookings/${w.ids.booking}/cancel`], ['post', `/api/bookings/${w.ids.booking}/pay`],
            ['get', `/api/services/inquiries/${w.ids.inquiry}`], ['post', `/api/services/inquiries/${w.ids.inquiry}/messages`, { text: 'hi' }],
            ['get', `/api/chat/bulk/${w.ids.bulk}`], ['get', `/api/chat/booking/${w.ids.booking}`], ['get', `/api/chat/inquiry/${w.ids.inquiry}`],
            ['post', `/api/chat/bulk/${w.ids.bulk}`, { text: 'hi' }], ['post', `/api/chat/inquiry/${w.ids.inquiry}`, { text: 'hi' }],
            ['put', `/api/addresses/${w.ids.address}`, { line1: 'taken over' }], ['delete', `/api/addresses/${w.ids.address}`],
        ];
        const leaks = [];
        for (const [m, p, b] of probes) {
            const r = await call(m, w.hyd.slug, t, p, b);
            const emptyRead = r.status === 200 && p.endsWith('/rating') && m === 'get' && (r.body.items || []).length === 0;   // the lookup is filtered by branch: it finds nothing
            if (!REFUSED.includes(r.status) && !emptyRead) leaks.push(`${m.toUpperCase()} ${p} -> ${r.status}`);
        }
        assert.deepEqual(leaks, []);
        // nothing changed in Mumbai
        assert.equal((await mongoose.model('Order').findById(w.ids.order)).status, 'placed');
        assert.equal((await Address.findById(w.ids.address)).line1, 'Secret street 9');
        assert.equal(await Address.countDocuments({ _id: w.ids.address }), 1);
    });

    test('a Hyderabad login sent to the Mumbai shop (x-tenant-slug) is refused on every kind of route', async () => {
        const w = await world();
        const probes = [
            ['customer', 'get', '/api/orders'], ['customer', 'get', '/api/addresses'], ['customer', 'get', `/api/orders/${w.ids.order}`], ['customer', 'post', '/api/orders/quote'],
            ['owner', 'get', '/api/shop/orders'], ['owner', 'get', `/api/shop/orders/${w.ids.order}`], ['owner', 'get', '/api/shop/riders'], ['owner', 'get', '/api/shop/staff'],
            ['owner', 'get', '/api/shop/customers'], ['owner', 'get', '/api/shop/bulk'], ['owner', 'patch', `/api/shop/orders/${w.ids.order}/status`],
            ['rider', 'get', '/api/rider/orders'], ['rider', 'get', '/api/rider/me'],
            ['owner', 'get', '/api/brand/me'], ['owner', 'get', '/api/brand/overview'],
        ];
        const leaks = [];
        for (const [who, m, p] of probes) {
            const r = await call(m, w.mum.slug, w.people[who], p, m === 'patch' ? { status: 'accepted' } : {});
            if (![401, 403, 404].includes(r.status)) leaks.push(`${who} ${m.toUpperCase()} ${p} -> ${r.status}`);
        }
        assert.deepEqual(leaks, []);
    });

    test('the Hyderabad owner and rider cannot touch Mumbai orders, bulk orders, inquiries, chats, customers, or riders by id', async () => {
        const w = await world();
        const owner = w.people.owner;
        const probes = [
            ['get', `/api/shop/orders/${w.ids.order}`], ['patch', `/api/shop/orders/${w.ids.order}/status`, { status: 'accepted' }],
            ['post', `/api/shop/orders/${w.ids.order}/food-ready`], ['post', `/api/shop/orders/${w.ids.order}/undo`],
            ['get', `/api/shop/bulk/${w.ids.bulk}`], ['get', `/api/shop/inquiries/${w.ids.inquiry}`],
            ['get', `/api/shop/chat/bulk/${w.ids.bulk}`], ['post', `/api/shop/chat/inquiry/${w.ids.inquiry}`, { text: 'hi' }], ['get', `/api/shop/chat/booking/${w.ids.booking}`],
            ['get', `/api/shop/customers/${w.ids.customer}`], ['put', `/api/shop/customers/${w.ids.customer}`, { name: 'x' }],
            ['patch', `/api/shop/staff/${w.ids.customer}`, { isActive: false }], ['delete', `/api/shop/staff/${w.ids.customer}`],
            ['delete', `/api/shop/riders/${w.ids.customer}`], ['patch', `/api/shop/riders/${w.ids.customer}`, { name: 'x' }],
        ];
        const leaks = [];
        for (const [m, p, b] of probes) {
            const r = await call(m, w.hyd.slug, owner, p, b);
            if (!REFUSED.includes(r.status)) leaks.push(`OWNER ${m.toUpperCase()} ${p} -> ${r.status}`);
        }
        // a rider of Hyderabad against the order of Mumbai
        for (const [m, p] of [['get', `/api/rider/orders/${w.ids.order}`], ['post', `/api/rider/orders/${w.ids.order}/accept`], ['post', `/api/rider/orders/${w.ids.order}/pickup`]]) {
            const r = await call(m, w.hyd.slug, w.people.rider, p);
            if (!REFUSED.includes(r.status)) leaks.push(`RIDER ${m.toUpperCase()} ${p} -> ${r.status}`);
        }
        assert.deepEqual(leaks, []);
        const after = await mongoose.model('Order').findById(w.ids.order).lean();
        assert.equal(after.status, 'placed');
        assert.equal(after.delivery && after.delivery.riderId, undefined);   // no rider took it
        assert.equal((await User.findById(w.ids.customer)).role, 'customer');
    });

    test('lists never mix: the Hyderabad owner sees none of the Mumbai orders; Mumbai dishes and coupons do not work in Hyderabad carts', async () => {
        const w = await world();
        const list = await call('get', w.hyd.slug, w.people.owner, '/api/shop/orders');
        assert.equal(list.status, 200);
        assert.equal((list.body.items || []).length, 0);
        assert.equal(JSON.stringify(list.body).includes(w.ids.order), false);

        const mine = await call('get', w.hyd.slug, w.people.customer, '/api/orders');
        assert.equal(JSON.stringify(mine.body).includes(w.ids.order), false);

        // a Mumbai dish id in a Hyderabad cart
        const q = await call('post', w.hyd.slug, w.people.customer, '/api/orders/quote', { orderType: 'pickup', items: [{ productId: w.ids.dish, quantity: 1 }] });
        assert.ok(REFUSED.includes(q.status), `quote with a Mumbai dish -> ${q.status}`);

        // a Hyderabad dish with a Mumbai coupon: no discount
        const hc = await Category.create({ tenantId: w.H._id, name: 'Mains' });
        const hd = await Product.create({ tenantId: w.H._id, categoryId: hc._id, name: 'Hyd Biryani', price: 200, isVeg: false });
        const q2 = await call('post', w.hyd.slug, w.people.customer, '/api/orders/quote', { orderType: 'pickup', items: [{ productId: String(hd._id), quantity: 1 }], couponCode: 'MUMBAI50' });
        const discount = q2.body && q2.body.pricing && q2.body.pricing.discount;
        assert.ok(q2.status >= 400 || !discount, `the Mumbai coupon gave ${discount} off in Hyderabad (status ${q2.status})`);
    });
});

describe('brand isolation: one brand never reaches another', () => {
    test('the owner of brand Rival cannot read, switch to, push to or move people of brand Savera', async () => {
        const w = await world();
        const rival = await newBrand('Rival', ['pune', 'goa'], 'riv');
        await post(`/api/admin/brands/${rival.brand._id}/owners`, { phone: '9877000001' });
        const rPune = await Tenant.findById(rival.out[0].id);
        const token = await tokenFor(rPune._id, '9877000001');
        const api = (m, p, b) => call(m, rival.out[0].slug, token, `/api/brand${p}`, b);

        // control: it works for its own brand
        assert.equal((await api('get', '/me')).status, 200);
        const own = await api('get', '/overview?range=30');
        assert.equal(own.status, 200);
        assert.deepEqual(own.body.branches.map((b) => b.slug).sort(), ['riv-goa', 'riv-pune']);

        // but nothing of Savera
        assert.equal((await api('get', '/orders?branch=sav-mumbai')).status, 404);
        assert.equal((await api('post', '/switch', { slug: w.mum.slug })).status, 404);
        assert.equal((await api('post', '/managers', { slug: w.mum.slug, phone: '9877000009' })).status, 404);
        assert.equal((await api('post', '/menu/push', { productIds: [w.ids.dish], toSlugs: [w.mum.slug] })).status, 404);
        assert.equal((await api('post', '/move', { fromSlug: rival.out[0].slug, toSlug: w.mum.slug, userId: w.ids.customer })).status, 404);
        const all = await api('get', '/orders');
        assert.equal(JSON.stringify(all.body).includes(w.ids.order), false);
        assert.equal(JSON.stringify(own.body).includes('Savera'), false);

        // a customer of Rival cannot switch to a Savera branch
        const rc = await makeUser(rPune, 'customer', '9877000002');
        assert.equal((await call('post', rival.out[0].slug, rc.accessToken, '/api/customer-branch/session', { slug: w.mum.slug })).status, 404);
        // and the pick by location lists only the brand's own branches
        await Tenant.updateOne({ slug: w.mum.slug }, { $set: { delivery: { latitude: 19.07, longitude: 72.87, radiusKm: 30 } } });
        const pick = await call('get', rival.out[0].slug, rc.accessToken, '/api/geo/branches?lat=19.07&lng=72.87');
        assert.equal(JSON.stringify(pick.body).includes('sav-mumbai'), false);
    });

    test('a branch manager (not a brand owner) of Savera has no brand powers, even over his own brand', async () => {
        const w = await world();
        const m = await tokenFor(w.H._id, '9811000002');   // the Hyderabad owner/manager
        for (const [method, path, body] of [
            ['get', '/me'], ['get', '/overview'], ['get', '/orders'], ['get', '/statement?period=2026-10'],
            ['post', '/switch', { slug: w.mum.slug }], ['post', '/managers', { slug: w.mum.slug, phone: '9899000001' }],
            ['post', '/menu/push', { productIds: [w.ids.dish], toSlugs: 'all' }], ['post', '/move', { fromSlug: w.hyd.slug, toSlug: w.mum.slug, userId: w.ids.customer }],
        ]) {
            const r = await call(method, w.hyd.slug, m, `/api/brand${path}`, body);
            assert.equal(r.status, 403, `${method} ${path} -> ${r.status}`);
        }
        assert.equal(await User.countDocuments({ tenantId: w.M._id, phone: '9899000001' }), 0);
    });

    test('a shop outside any brand cannot use the brand routes or the branch switch', async () => {
        const w = await world();
        const solo = (await post('/api/admin/tenants', { slug: 'lonely-shop', name: 'Lonely', businessType: 'restaurant' })).body.tenant;
        const soloShop = await Tenant.findById(solo._id);
        const ownerToken = await ownerOf(soloShop, '9866000001');
        const c = await makeUser(soloShop, 'customer', '9866000002');
        assert.equal((await call('get', 'lonely-shop', ownerToken, '/api/brand/me')).status, 403);
        assert.equal((await call('post', 'lonely-shop', ownerToken, '/api/brand/switch', { slug: w.mum.slug })).status, 403);
        assert.equal((await call('post', 'lonely-shop', c.accessToken, '/api/customer-branch/session', { slug: w.mum.slug })).status, 403);
    });
});
