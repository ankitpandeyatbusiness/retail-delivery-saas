// Helpers that build a shop, people with login tokens, orders and a superadmin for tests.
const mongoose = require('mongoose');
const Tenant = require('../../src/models/Tenant');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const Order = require('../../src/models/Order');
const Rider = require('../../src/models/Rider');
const SuperAdmin = require('../../src/models/SuperAdmin');
const tokenService = require('../../src/services/tokenService');
const { signAdminToken } = require('../../src/services/superAdminToken');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// waits until fn() returns something true (checks every 100 ms)
async function waitFor(fn, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return true;
        await sleep(100);
    }
    return false;
}

// Use a NEW slug in every test: the app keeps shops in a 60 second cache
const makeTenant = (slug = 'shop-a', extra = {}) => Tenant.create({
    slug,
    name: `Shop ${slug}`,
    settings: { orders: { types: ['delivery', 'pickup'], payments: ['cod'] } },
    billing: { state: 'active' },
    ...extra,
});

// A person with a live session. Use  .set(u.headers)  on a request to act as him.
async function makeUser(tenant, role = 'customer', phone = '9000000001') {
    const user = await User.create({ tenantId: tenant._id, phone, role, name: `${role} ${phone.slice(-4)}` });
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({
        userId: user._id, tenantId: tenant._id, sessionId,
    });
    await Session.create({
        _id: sessionId, userId: user._id, tenantId: tenant._id,
        refreshTokenHash: tokenService.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS),
    });
    if (role === 'rider') await Rider.create({ tenantId: tenant._id, userId: user._id, name: user.name, isOnline: true });
    return {
        user, accessToken, refreshToken,
        headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': tenant.slug },
    };
}

// One call gives a shop with an owner, a rider and a customer
async function makeWorld(slug = 'shop-a') {
    const tenant = await makeTenant(slug);
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const rider = await makeUser(tenant, 'rider', '9000000020');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    return { tenant, owner, rider, customer };
}

let orderSeq = 1000;
const makeOrder = (tenant, user, o = {}) => Order.create({
    tenantId: tenant._id,
    userId: user._id,
    orderNo: ++orderSeq,
    status: 'placed',
    orderType: 'delivery',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Test item', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 },
    payment: { method: 'cod' },
    customer: { name: user.name, phone: user.phone },
    statusHistory: [{ status: 'placed' }],
    ...o,
});

async function makeSuperAdmin(email = 'boss@example.com') {
    const admin = new SuperAdmin({ email, name: 'Boss' });
    await admin.setPassword('a-long-test-password');
    await admin.save();
    return { admin, token: signAdminToken(admin) };
}

module.exports = { sleep, waitFor, makeTenant, makeUser, makeWorld, makeOrder, makeSuperAdmin };