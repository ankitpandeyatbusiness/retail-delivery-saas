// The public demo shop and its pretend people. A demo session on ANY shop can open the Owner, Cook, Waiter and Rider panels:
// those run inside this one shop (slug "demo"), so no real customer, order, rider or money is ever shown. The Customer panel
// stays in the shop where the demo started. Everything in here is fake. (Phase 3 fills the shop with content.)
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Staff = require('../models/Staff');
const Rider = require('../models/Rider');
const { hashPhone } = require('../utils/phoneHash');

const SLUG = String(process.env.DEMO_SLUG || 'demo').toLowerCase();
const FAKE_PREFIX = '60000000';   // 6000000001 .. 6000000005: not real phone numbers, never sent an SMS
const PEOPLE = {
    admin: { phone: `${FAKE_PREFIX}01`, name: 'Demo owner' },
    kitchen: { phone: `${FAKE_PREFIX}02`, name: 'Meera (cook)' },
    waiter: { phone: `${FAKE_PREFIX}03`, name: 'Sunil (waiter)' },
    rider: { phone: `${FAKE_PREFIX}04`, name: 'Ravi (rider)' },
    customer: { phone: `${FAKE_PREFIX}05`, name: 'Aarav (customer)' },
};
const PANELS = [
    { key: 'customer', role: 'customer', label: 'Customer' },
    { key: 'owner', role: 'admin', label: 'Owner' },
    { key: 'cook', role: 'kitchen', label: 'Cook' },
    { key: 'waiter', role: 'waiter', label: 'Waiter' },
    { key: 'rider', role: 'rider', label: 'Rider' },
];

const isFakePhone = (p) => String(p || '').startsWith(FAKE_PREFIX);

async function ensureTenant() {
    let t = await Tenant.findOne({ slug: SLUG });
    if (t) {
        if (!t.isDemo) { t.isDemo = true; await t.save(); }
        return t;
    }
    try {
        t = await Tenant.create({
            slug: SLUG, name: 'Demo Shop', isDemo: true, tagline: 'A shop to try the app',
            settings: {
                orders: { types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'], dineIn: { enabled: true }, staff: { kitchenOn: true, waiterOn: true, max: 10 } },
                features: { services: true, tableBooking: true, bulkOrders: true, favourites: true, tips: true },
            },
            billing: { state: 'active', isLive: false },
            plan: { id: 'pro', startedAt: new Date(), endsAt: new Date('2099-12-31') },
        });
    } catch (e) {
        if (e && e.code === 11000) return Tenant.findOne({ slug: SLUG });
        throw e;
    }
    return t;
}

// the pretend person for a panel in the demo shop (made on first use)
async function personFor(tenant, role) {
    const p = PEOPLE[role === 'admin' ? 'admin' : role];
    const user = await User.findOneAndUpdate(
        { tenantId: tenant._id, phone: p.phone },
        { $set: { role, name: p.name, phoneHash: hashPhone(tenant._id, p.phone), lastLoginAt: new Date() } },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    );
    if (role === 'kitchen' || role === 'waiter') {
        await Staff.updateOne({ tenantId: tenant._id, userId: user._id }, { $setOnInsert: { role, name: p.name, isActive: true } }, { upsert: true });
    }
    if (role === 'rider') {
        await Rider.updateOne({ tenantId: tenant._id, userId: user._id }, { $setOnInsert: { name: p.name, isActive: true, isOnline: false } }, { upsert: true });
    }
    return user;
}

// which panels this demo can show right now
async function panelsFor(demoTenant) {
    const st = (demoTenant.settings && demoTenant.settings.orders && demoTenant.settings.orders.staff) || {};
    return PANELS.map((p) => ({
        key: p.key, label: p.label,
        available: p.key === 'cook' ? st.kitchenOn === true : p.key === 'waiter' ? st.waiterOn === true : true,
    }));
}

module.exports = { SLUG, PEOPLE, PANELS, isFakePhone, ensureTenant, personFor, panelsFor };
