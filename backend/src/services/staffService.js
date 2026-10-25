// Shop staff (kitchen and waiter): the owner adds a phone number and a job, the person logs in with an OTP and sees only their own panel.
// What the super admin allows is in settings.orders.staff { kitchenOn, waiterOn, max } (off by default, per shop).
const User = require('../models/User');
const Staff = require('../models/Staff');
const Order = require('../models/Order');
const Session = require('../models/Session');
const TableSession = require('../models/TableSession');
const { ACTIVE_STATUSES } = require('./orderflow');
const { httpError } = require('../middlewares/apiErrors');
const { hashPhone } = require('../utils/phoneHash');
const { resolveConfig, DEFAULTS } = require('./tenantConfigService');

const PHONE_RE = /^[6-9]\d{9}$/;
const ROLES = ['kitchen', 'waiter'];
const JOB = { kitchen: 'Kitchen', waiter: 'Waiter' };

const rulesOf = (tenant) => ({ ...DEFAULTS.orders.staff, ...(resolveConfig(tenant).orders.staff || {}) });
const allowed = (rules, role) => (role === 'kitchen' ? rules.kitchenOn : rules.waiterOn) === true;

const shape = (s, phone, closed = false) => ({ userId: String(s.userId), role: s.role, job: JOB[s.role], name: s.name || '', phone: phone || '', isActive: s.isActive, photo: s.photo || null, lastSeenAt: s.lastSeenAt || null, duty: require('./staffDuty').statusOf(s, new Date(), closed) });   // duty: on | off | outside | holiday

async function list(tenant, { stats = false } = {}) {
    const rows = await Staff.find({ tenantId: tenant._id }).sort({ role: 1, createdAt: 1 }).lean();
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('phone').lean();
    const phone = new Map(users.map((u) => [String(u._id), u.phone]));
    const rules = rulesOf(tenant);
    const duty = require('./staffDuty');
    const closedBy = { kitchen: (await duty.closedFor(tenant, 'kitchen')).closed, waiter: (await duty.closedFor(tenant, 'waiter')).closed };
    // the owner's Kitchen staff / Waiters pages also want what each person did today and this week
    const done = new Map();
    if (stats) for (const role of ROLES) { const ids = rows.filter((r) => r.role === role).map((r) => r.userId); if (ids.length) for (const [k, v] of await require('./staffStats').forRole(tenant._id, role, ids)) done.set(k, v); }
    return {
        items: rows.map((r) => ({ ...shape(r, phone.get(String(r.userId)), closedBy[r.role]), panelOn: allowed(rules, r.role), ...(stats ? { stats: done.get(String(r.userId)) || null } : {}) })),
        rules: { kitchenOn: rules.kitchenOn === true, waiterOn: rules.waiterOn === true, max: rules.max, queueSec: resolveConfig(tenant).orders.kitchenQueueSec || 60 },
    };
}

// Gives this phone a job in the shop. A person who already has a job here gets the new one. An owner or a rider is never changed.
async function add({ tenant, phone, name, role }) {
    const tenantId = tenant._id;
    phone = String(phone || '').trim();
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
    if (!ROLES.includes(role)) throw httpError(400, 'Choose Kitchen or Waiter');
    const rules = rulesOf(tenant);
    if (!allowed(rules, role)) throw httpError(403, `The ${JOB[role].toLowerCase()} panel is not switched on for your shop. Please contact support.`);

    const existing = await User.findOne({ tenantId, phone }).select('role isBlocked').lean();
    if (existing?.role === 'admin') throw httpError(409, 'This number belongs to the shop owner. Use another number.');
    if (existing?.role === 'rider') throw httpError(409, 'This number is a rider. Remove the rider first, or use another number.');
    if (existing?.isBlocked) throw httpError(409, 'This number is blocked');

    const mine = existing ? await Staff.findOne({ tenantId, userId: existing._id }).select('_id isActive').lean() : null;
    if (!mine) {
        const count = await Staff.countDocuments({ tenantId });
        if (count >= rules.max) throw httpError(409, `You can add up to ${rules.max} staff. Remove someone first, or ask support to raise the limit.`);
    }
    if (existing && !mine) {
        // a customer becomes staff: not while an order or a table is open (it would be left without an owner)
        const [order, table] = await Promise.all([
            Order.exists({ tenantId, userId: existing._id, status: { $in: ACTIVE_STATUSES } }),
            TableSession.exists({ tenantId, customers: existing._id, status: { $in: ['open', 'bill_asked'] } }),
        ]);
        if (order || table) throw httpError(409, 'This person has an order or a table open right now. Try again after it is finished.');
    }

    let user;
    try {
        user = await User.findOneAndUpdate(
            { tenantId, phone, role: { $nin: ['admin', 'rider'] } },     // the filter also protects against a race with an owner or a rider
            { $set: { role, phoneHash: hashPhone(tenantId, phone) } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
    } catch (e) {
        if (e.code === 11000) throw httpError(409, 'This number is already used by the owner or a rider. Use another number.');
        throw e;
    }
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    const set = { role, isActive: true, ...(cleanName ? { name: cleanName } : {}) };
    const row = await Staff.findOneAndUpdate({ tenantId, userId: user._id }, { $set: set }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    if (mine) await Session.deleteMany({ userId: user._id, tenantId });   // a new job: sign in again so the app opens the right panel
    return { ...shape(row, phone), added: !mine };
}

async function update({ tenant, userId, isActive, name, role }) {
    const tenantId = tenant._id;
    const row = await Staff.findOne({ tenantId, userId });
    if (!row) throw httpError(404, 'Staff member not found');
    let logOut = false;
    if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') throw httpError(400, 'isActive must be true or false');
        if (isActive && !row.isActive && !allowed(rulesOf(tenant), row.role)) throw httpError(403, `The ${JOB[row.role].toLowerCase()} panel is not switched on for your shop`);
        if (!isActive) logOut = true;
        row.isActive = isActive;
    }
    if (name !== undefined) row.name = String(name).trim().slice(0, 80);
    if (role !== undefined && role !== row.role) {
        if (!ROLES.includes(role)) throw httpError(400, 'Choose Kitchen or Waiter');
        if (!allowed(rulesOf(tenant), role)) throw httpError(403, `The ${JOB[role].toLowerCase()} panel is not switched on for your shop`);
        row.role = role;
        await User.updateOne({ _id: userId, tenantId, role: { $in: ROLES } }, { $set: { role } });
        logOut = true;
    }
    await row.save();
    if (logOut) await Session.deleteMany({ userId, tenantId });   // paused or moved to another job: out at once
    const u = await User.findById(userId).select('phone').lean();
    return shape(row, u?.phone);
}

async function remove({ tenant, userId }) {
    const tenantId = tenant._id;
    const row = await Staff.findOne({ tenantId, userId });
    if (!row) throw httpError(404, 'Staff member not found');
    await Staff.deleteOne({ _id: row._id });
    await User.updateOne({ _id: userId, tenantId, role: { $in: ROLES } }, { $set: { role: 'customer' } });
    await Session.deleteMany({ userId, tenantId });          // logged out now; the number can sign in again as a customer
    return { ok: true };
}

// The panel a logged-in person may use right now, or the reason they cannot (the staff routes and the app both read this).
async function accessOf({ tenant, userId }) {
    const [user, row] = await Promise.all([
        User.findOne({ _id: userId, tenantId: tenant._id }).select('role isBlocked phone name').lean(),
        Staff.findOne({ tenantId: tenant._id, userId }).lean(),
    ]);
    if (!user || user.isBlocked || !ROLES.includes(user.role) || !row || row.role !== user.role) return { ok: false, code: 'not_staff', message: 'This account is not shop staff' };
    if (!row.isActive) return { ok: false, code: 'paused', message: 'Your staff account is switched off. Please ask the shop owner.' };
    if (!allowed(rulesOf(tenant), row.role)) return { ok: false, code: 'panel_off', message: `The ${JOB[row.role].toLowerCase()} panel is switched off for this shop.` };
    return { ok: true, role: row.role, user, row };
}

module.exports = { list, add, update, remove, accessOf, rulesOf, ROLES, JOB };
