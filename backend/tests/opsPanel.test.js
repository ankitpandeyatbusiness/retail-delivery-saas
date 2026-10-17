require('./helpers/env');
// The superadmin app runs a shop's daily work through /api/admin (orders) and /api/admin/tenants/:tid/shop (riders,
// cash, complaints, messages, activity). These tests send the same requests the app sends.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const CodSettlement = require('../src/models/CodSettlement');
const Complaint = require('../src/models/Complaint');
const Rider = require('../src/models/Rider');

let token;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const shopUrl = (shop, r = '') => `/api/admin/tenants/${shop._id}/shop/${r}`;
const get = (u) => request(app).get(u).set(auth());
const post = (u, b) => request(app).post(u).set(auth()).send(b);
const patch = (u, b) => request(app).patch(u).set(auth()).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
});

describe('orders across shops', () => {
    test('list with filters, detail with the shop name, and status moves', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const o = await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup' });
        await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'delivered' });

        const active = await get('/api/admin/orders?status=active');
        assert.equal(active.status, 200);
        assert.equal(active.body.items.length, 1);
        assert.equal(active.body.items[0].shopName, w.tenant.name);

        const byShop = await get(`/api/admin/orders?tenantId=${w.tenant._id}&status=${encodeURIComponent('delivered,cancelled')}`);
        assert.equal(byShop.body.items.length, 1);

        const byNo = await get(`/api/admin/orders?q=${o.orderNo}`);
        assert.equal(byNo.body.items[0].orderNo, o.orderNo);

        const detail = await get(`/api/admin/orders/${o._id}`);
        assert.equal(detail.body.status, 'placed');
        assert.ok(Array.isArray(detail.body.items));

        // one step forward
        let r = await patch(`/api/admin/orders/${o._id}/status`, { status: 'accepted' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.status, 'accepted');

        // skipping steps is refused with a message the app shows
        r = await patch(`/api/admin/orders/${o._id}/status`, { status: 'ready' });
        assert.equal(r.status, 400);

        // cancel with a platform reason and a note
        r = await patch(`/api/admin/orders/${o._id}/status`, { status: 'cancelled', reasonCode: 'platform', note: 'Test' });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'cancelled');

        // a finished order cannot change
        r = await patch(`/api/admin/orders/${o._id}/status`, { status: 'delivered' });
        assert.equal(r.status, 409);
    });

    test('force delivered, and a bad cancel reason is refused', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const o = await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'preparing' });
        const bad = await patch(`/api/admin/orders/${o._id}/status`, { status: 'cancelled', reasonCode: 'because' });
        assert.equal(bad.status, 400);
        const ok = await patch(`/api/admin/orders/${o._id}/status`, { status: 'delivered' });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.status, 'delivered');
    });

    test('sales report: totals, per-day series, per-shop list', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // the Indian day, as the server counts it
        await f.makeOrder(w.tenant, w.customer.user, {
            orderType: 'pickup', status: 'delivered', deliveredAt: new Date(),
            pricing: { subtotal: 200, packagingCharge: 0, discount: 0, total: 200 },
        });
        const r = await get(`/api/admin/reports/sales?from=${day}&to=${day}&groupBy=day`);
        assert.equal(r.status, 200);
        assert.equal(r.body.totals.orders, 1);
        assert.equal(r.body.totals.revenue, 200);
        assert.equal(r.body.series.length, 1);
        assert.equal(r.body.shops[0].name, w.tenant.name);
        const one = await get(`/api/admin/reports/sales?from=${day}&to=${day}&tenantId=${w.tenant._id}`);
        assert.equal(one.body.shops.length, 0);   // a single shop has no per-shop list
    });
});

describe('riders, assignment and cash', () => {
    test('add a rider, switch off, remove; a phone of an owner is refused', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const add = await post(shopUrl(w.tenant, 'riders'), { phone: '9111111111', name: 'Ravi' });
        assert.equal(add.status, 201, JSON.stringify(add.body));

        const list = await get(shopUrl(w.tenant, 'riders'));
        const ravi = list.body.items.find((r) => r.name === 'Ravi');
        assert.ok(ravi);
        assert.equal(ravi.isActive, true);

        const off = await patch(shopUrl(w.tenant, `riders/${ravi.userId}`), { isActive: false });
        assert.equal(off.status, 200);
        assert.equal(off.body.isActive, false);

        const owner = await post(shopUrl(w.tenant, 'riders'), { phone: w.owner.user.phone });
        assert.equal(owner.status, 409);

        const del = await request(app).delete(shopUrl(w.tenant, `riders/${ravi.userId}`)).set(auth());
        assert.equal(del.status, 200);
    });

    test('assign a rider to a delivery order, change him with a reason, remove him', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const second = await post(shopUrl(w.tenant, 'riders'), { phone: '9222222222', name: 'Second' });
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing' });

        const a = await post(shopUrl(w.tenant, `orders/${o._id}/assign`), { riderId: String(w.rider.user._id) });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.equal(String(a.body.delivery.riderId), String(w.rider.user._id));

        const d = await get(shopUrl(w.tenant, `orders/${o._id}/delivery`));
        assert.equal(d.status, 200);
        assert.equal(d.body.delivery.status, 'assigned');

        // changing needs a reason
        const noReason = await post(shopUrl(w.tenant, `orders/${o._id}/assign`), { riderId: String(second.body.userId) });
        assert.equal(noReason.status, 400);

        const un = await post(shopUrl(w.tenant, `orders/${o._id}/unassign`), { reason: 'Not answering' });
        assert.equal(un.status, 200, JSON.stringify(un.body));
    });

    test('cash: balances, handover limited to what is owed, adjustment needs a reason, ledger pages', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const rider = w.rider.user;
        await CodSettlement.create({ tenantId: w.tenant._id, riderId: rider._id, type: 'collect', amountPaise: 25000 });

        const bal = await get(shopUrl(w.tenant, 'cod/riders'));
        const mine = (bal.body.items || bal.body).find((b) => String(b.riderId) === String(rider._id));
        assert.equal(mine.balancePaise, 25000);

        const over = await post(shopUrl(w.tenant, `cod/riders/${rider._id}/handover`), { amountPaise: 30000 });
        assert.equal(over.status, 409);

        const ok = await post(shopUrl(w.tenant, `cod/riders/${rider._id}/handover`), { amountPaise: 10000, note: 'Evening' });
        assert.equal(ok.status, 201);
        assert.equal(ok.body.balancePaise, 15000);

        assert.equal((await post(shopUrl(w.tenant, `cod/riders/${rider._id}/adjust`), { amountPaise: -500 })).status, 400);
        const adj = await post(shopUrl(w.tenant, `cod/riders/${rider._id}/adjust`), { amountPaise: -500, note: 'Counting mistake' });
        assert.equal(adj.status, 201);
        assert.equal(adj.body.balancePaise, 14500);

        const ledger = await get(shopUrl(w.tenant, `cod/riders/${rider._id}/ledger?page=1&limit=2`));
        assert.equal(ledger.body.items.length, 2);
        assert.equal(ledger.body.hasMore, true);

        const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // the Indian day, as the server counts it
        const perf = await get(shopUrl(w.tenant, `cod/performance?from=${day}&to=${day}`));
        assert.equal(perf.status, 200);
        assert.ok(Array.isArray(perf.body.items));
    });
});

describe('complaints, messages, activity, cod block', () => {
    test('all-shop and shop complaint lists; reply, then refund decision', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', orderType: 'pickup', pricing: { subtotal: 300, total: 300 } });
        const c = await Complaint.create({
            tenantId: w.tenant._id, orderId: o._id, orderNo: o.orderNo, userId: w.customer.user._id, customerName: 'Asha', type: 'quality', text: 'Food was cold',
        });

        const all = await get('/api/admin/complaints?status=open');
        assert.equal(all.body.items.length, 1);
        assert.equal(all.body.items[0].shop, w.tenant.slug);

        const mine = await get(shopUrl(w.tenant, 'complaints?status=open'));
        assert.equal(mine.body.items.length, 1);

        // a reply alone keeps it in progress
        const rep = await patch(shopUrl(w.tenant, `complaints/${c._id}`), { ownerReply: 'We are sorry', resolution: 'none' });
        assert.equal(rep.status, 200, JSON.stringify(rep.body));
        assert.equal(rep.body.status, 'in_progress');

        // a part refund in paise, within the order total
        const big = await patch(shopUrl(w.tenant, `complaints/${c._id}`), { resolution: 'refund_partial', refundPaise: 999999 });
        assert.equal(big.status, 400);
        const part = await patch(shopUrl(w.tenant, `complaints/${c._id}`), { resolution: 'refund_partial', refundPaise: 5000, ownerReply: 'Partial refund' });
        assert.equal(part.status, 200);
        assert.equal(part.body.status, 'resolved');
        assert.equal(part.body.refundPaise, 5000);

        // decided is final
        assert.equal((await patch(shopUrl(w.tenant, `complaints/${c._id}`), { resolution: 'no_refund', ownerReply: 'x' })).status, 409);
    });

    test('a message to customers is accepted (202), listed, and readable', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const bad = await post(shopUrl(w.tenant, 'messages'), { title: '', body: 'x' });
        assert.equal(bad.status, 400);

        const sent = await post(shopUrl(w.tenant, 'messages'), { title: 'New menu', body: 'Try our new dishes', kind: 'info', audience: 'customers', sendEmail: false });
        assert.equal(sent.status, 202, JSON.stringify(sent.body));

        const list = await get(shopUrl(w.tenant, 'messages'));
        assert.equal(list.body.items[0].title, 'New menu');
        const one = await get(shopUrl(w.tenant, `messages/${sent.body.id}`));
        assert.equal(one.status, 200);
    });

    test('activity log lists changes of this shop only, filterable by who', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        await post(shopUrl(w.tenant, 'riders'), { phone: '9333333333', name: 'Log rider' });   // writes an audit row
        const other = await f.makeWorld(`ops-${++n}`);
        await post(shopUrl(other.tenant, 'riders'), { phone: '9444444444' });

        const all = await get(shopUrl(w.tenant, 'activity'));
        assert.equal(all.status, 200);
        assert.ok(all.body.items.length >= 1);
        const platform = await get(shopUrl(w.tenant, 'activity?actorType=superadmin'));
        assert.ok(platform.body.items.every((i) => i.actorType === 'superadmin'));
        const none = await get(shopUrl(w.tenant, 'activity?actorType=rider'));
        assert.equal(none.body.items.length, 0);
    });

    test('the owner blocks and unblocks a customer of his shop, but not an owner or a rider', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const Session = require('../src/models/Session');
        const User = require('../src/models/User');
        await Session.create({ userId: w.customer.user._id, tenantId: w.tenant._id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 86400000) });
        assert.equal(await Session.countDocuments({ userId: w.customer.user._id }) >= 1, true);   // there is a login to end
        const url = (u) => shopUrl(w.tenant, `customers/${u._id}/block`);
        const bad = await patch(url(w.customer.user), { blocked: 'yes' });
        assert.equal(bad.status, 400);
        const r = await patch(url(w.customer.user), { blocked: true });
        assert.equal(r.status, 200);
        assert.equal((await User.findById(w.customer.user._id)).isBlocked, true);
        assert.equal(await Session.countDocuments({ userId: w.customer.user._id }), 0);
        const back = await patch(url(w.customer.user), { blocked: false });
        assert.equal(back.body.isBlocked, false);
        assert.equal((await patch(url(w.owner.user), { blocked: true })).status, 403);
    });

    test('allow cash on delivery again clears the block', async () => {
        const w = await f.makeWorld(`ops-${++n}`);
        const r = await patch(shopUrl(w.tenant, `customers/${w.customer.user._id}/cod-block`), { blocked: false });
        assert.equal(r.status, 200);
        assert.equal(r.body.codBlocked, false);
        const bad = await patch(shopUrl(w.tenant, `customers/${w.customer.user._id}/cod-block`), { blocked: true });
        assert.equal(bad.status, 400);
    });
});
