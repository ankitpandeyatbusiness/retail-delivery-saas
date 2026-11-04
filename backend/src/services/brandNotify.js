// Which branch's alerts reach a BRAND OWNER's phone. A brand owner is an owner of every branch of the brand, so without a rule his phone
// would ring for all of them. The rule (his own choices, kept on the brand):
//   - a branch he marked "I manage this branch myself" always notifies him (unless he switched it off)
//   - the branch his app is open on right now notifies him (the branch of his most recently used login)
//   - every other branch is OFF, unless he switched it on, or the master switch "Notify me from every branch" is on
//   - a few serious alerts (CRITICAL) come through even from a branch that is off
// Every alert he gets is labelled with its branch. Nothing here touches cooks, waiters, riders or branch managers.
const Tenant = require('../models/Tenant');
const Brand = require('../models/Brand');
const User = require('../models/User');
const Session = require('../models/Session');

// a rider's SOS, an order nobody accepted, a shop paused for rent, a bill that is overdue or about to be
const CRITICAL = new Set(['rider_sos', 'order_unaccepted_reminder', 'shop_paused', 'bill_overdue', 'bill_reminder', 'rent_nudge']);

const TTL = 15000;
const cache = new Map();   // key -> { at, value }
const remember = async (key, make) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = await make();
    cache.set(key, { at: Date.now(), value });
    return value;
};
const forget = () => cache.clear();

const tenantInfo = (tenantId) => remember(`t:${tenantId}`, async () => {
    const t = await Tenant.findById(tenantId).select('brandId name').lean();
    return t ? { brandId: t.brandId ? String(t.brandId) : null, name: t.name } : null;
});
const brandInfo = (brandId) => remember(`b:${brandId}`, async () => {
    const b = await Brand.findById(brandId).select('name ownerPhones ownerNotify').lean();
    if (!b) return null;
    const prefs = new Map();
    for (const p of b.ownerNotify || []) {
        prefs.set(p.phone, { all: !!p.all, own: p.ownTenantId ? String(p.ownTenantId) : null, branches: p.branches instanceof Map ? Object.fromEntries(p.branches) : (p.branches || {}) });
    }
    return { name: b.name, owners: new Set(b.ownerPhones || []), prefs };
});

// the branch his app is open on: where his most recently used login is
const openBranch = (brandId, phone) => remember(`o:${brandId}:${phone}`, async () => {
    const tenants = await Tenant.find({ brandId }).select('_id').lean();
    const users = await User.find({ tenantId: { $in: tenants.map((t) => t._id) }, phone, role: 'admin' }).select('_id tenantId').lean();
    if (!users.length) return null;
    const s = await Session.findOne({ userId: { $in: users.map((u) => u._id) } }).sort({ lastUsedAt: -1 }).select('tenantId').lean();
    return s ? String(s.tenantId) : null;
});

// Does a brand owner (phone) get the alerts of this branch? pref = his saved choices (or none)
function decide({ pref, tenantId, open, type }) {
    const id = String(tenantId);
    if (type && CRITICAL.has(type)) return true;
    const p = pref || { all: false, own: null, branches: {} };
    if (p.all) return true;
    const explicit = p.branches[id];
    if (explicit === true || explicit === false) return explicit;
    if (p.own === id) return true;
    return open === id;
}

// For one push: which of these people (userIds of this branch) must NOT be pushed, and which branch label goes on the alert of each.
// A shop that is not a branch, and every person who is not a brand owner, is left alone.
async function gate({ tenantId, userIds, type }) {
    const out = { drop: new Set(), label: new Map() };
    const t = await tenantInfo(tenantId);
    if (!t || !t.brandId) return out;
    const brand = await brandInfo(t.brandId);
    if (!brand || !brand.owners.size) return out;
    const people = await User.find({ _id: { $in: userIds } }).select('phone role').lean();
    for (const u of people) {
        if (u.role !== 'admin' || !brand.owners.has(u.phone)) continue;
        out.label.set(String(u._id), t.name);   // a brand owner always sees which branch it came from
        const open = await openBranch(t.brandId, u.phone);
        if (!decide({ pref: brand.prefs.get(u.phone), tenantId, open, type })) out.drop.add(String(u._id));
    }
    return out;
}

// phones that must not get an SMS about this branch (the same rule, for the SMS that follows a push nobody heard)
async function mutedPhones({ tenantId, phones, type }) {
    const t = await tenantInfo(tenantId);
    if (!t || !t.brandId) return new Set();
    const brand = await brandInfo(t.brandId);
    if (!brand) return new Set();
    const muted = new Set();
    for (const phone of phones) {
        if (!brand.owners.has(phone)) continue;
        const open = await openBranch(t.brandId, phone);
        if (!decide({ pref: brand.prefs.get(phone), tenantId, open, type })) muted.add(phone);
    }
    return muted;
}

// The settings screen: every branch with what applies right now.
async function view(brand, phone) {
    const branches = await Tenant.find({ brandId: brand._id }).sort({ createdAt: 1, _id: 1 }).select('slug name branchCity address.city').lean();
    const saved = (brand.ownerNotify || []).find((p) => p.phone === phone) || {};
    const pref = { all: !!saved.all, own: saved.ownTenantId ? String(saved.ownTenantId) : null, branches: saved.branches instanceof Map ? Object.fromEntries(saved.branches) : (saved.branches || {}) };
    const open = await openBranch(String(brand._id), phone);
    return {
        all: pref.all,
        ownSlug: (branches.find((b) => String(b._id) === pref.own) || {}).slug || null,
        branches: branches.map((b) => ({
            slug: b.slug, name: b.name, city: b.branchCity || (b.address && b.address.city) || null,
            own: pref.own === String(b._id), open: open === String(b._id),
            explicit: pref.branches[String(b._id)] === true ? true : pref.branches[String(b._id)] === false ? false : null,   // what he chose (null = nothing chosen)
            on: decide({ pref, tenantId: b._id, open, type: null }),                                                           // what applies now
        })),
    };
}

module.exports = { CRITICAL, gate, mutedPhones, decide, view, openBranch, forget };
