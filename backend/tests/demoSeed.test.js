require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const demoSeed = require('../src/services/demoSeed');
const demoTenant = require('../src/services/demoTenant');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Order = require('../src/models/Order');
const Staff = require('../src/models/Staff');
const Rider = require('../src/models/Rider');
const Brand = require('../src/models/Brand');
const ShopService = require('../src/models/ShopService');
const TableBookingConfig = require('../src/models/TableBookingConfig');
const User = require('../src/models/User');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });

describe('the demo shop content', () => {
    test('a full shop is made: menu with photos, offers, services, booking, team, history, 3 branches', async () => {
        const r = await demoSeed.seed();
        const t = await Tenant.findOne({ slug: demoTenant.SLUG });
        assert.ok(r.products >= 30);
        assert.equal(await Product.countDocuments({ tenantId: t._id }), r.products);
        assert.equal(await Category.countDocuments({ tenantId: t._id }), 9);
        const noPhoto = await Product.countDocuments({ tenantId: t._id, image: { $in: [null, undefined, ''] } });
        assert.ok(noPhoto <= 2, `only a few items may lack a photo, ${noPhoto} do`);
        assert.ok((await Product.findOne({ tenantId: t._id, image: { $exists: true } })).image.includes('wikimedia.org/'));
        assert.ok(await Product.countDocuments({ tenantId: t._id, isVeg: true }) > 5);
        assert.ok(await Product.countDocuments({ tenantId: t._id, isVeg: false }) > 5);
        assert.equal(await ShopService.countDocuments({ tenantId: t._id }), 3);
        assert.equal((await TableBookingConfig.findOne({ tenantId: t._id })).tables.length, 8);
        assert.ok(await Order.countDocuments({ tenantId: t._id, status: 'delivered' }) >= 20);
        assert.ok(await Staff.countDocuments({ tenantId: t._id }) >= 2);
        assert.ok(await Rider.countDocuments({ tenantId: t._id }) >= 2);
        const brand = await Brand.findOne({ mainTenantId: t._id });
        assert.equal(await Tenant.countDocuments({ brandId: brand._id }), 3);
        const city = await Tenant.findOne({ slug: 'demo-city' });
        assert.equal(await Product.countDocuments({ tenantId: city._id }), r.products);
    });

    test('running it again rebuilds the same shop and keeps the demo people', async () => {
        await demoSeed.seed();
        const t = await Tenant.findOne({ slug: demoTenant.SLUG });
        const a = await Product.countDocuments({ tenantId: t._id });
        const owner = await demoTenant.personFor(t, 'admin');
        await demoSeed.seed();
        assert.equal(await Product.countDocuments({ tenantId: t._id }), a);
        assert.equal(await Order.countDocuments({ tenantId: t._id }) > 0, true);
        assert.ok(await User.findById(owner._id));
        assert.equal(await Tenant.countDocuments({ slug: demoTenant.SLUG }), 1);
    });

    test('a visitor sees the shop through the real public API: theme, menu, banners, offers', async () => {
        await demoSeed.seed();
        const h = { 'x-tenant-slug': demoTenant.SLUG };
        const theme = await request(app).get('/api/tenants/theme').set(h);
        assert.equal(theme.status, 200);
        assert.equal(theme.body.name, 'Demo Shop');
        const menu = await request(app).get('/api/catalog/products').set(h);
        assert.equal(menu.status, 200);
        assert.ok(JSON.stringify(menu.body).includes('Butter Chicken'));
        const banners = await request(app).get('/api/catalog/banners').set(h);
        assert.equal(banners.status, 200);
        assert.ok(JSON.stringify(banners.body).includes('Biryani Fest'));
    });
});
