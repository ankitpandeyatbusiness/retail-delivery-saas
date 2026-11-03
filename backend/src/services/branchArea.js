// The map pin and delivery radius of a shop: who changed them last, and the optional LOCK.
// A branch's pin and radius decide which customers it serves, so the supreme admin can lock them: a branch manager can then no longer move the pin
// or widen the radius (he would take customers from the next branch). A superadmin and the brand owner can still change a locked area.
const Brand = require('../models/Brand');
const User = require('../models/User');

const AREA_KEYS = ['latitude', 'longitude', 'radiusKm'];
const LOCK_MESSAGE = 'The map pin and delivery radius of this branch are locked by the head office. Ask your brand owner or support to change them.';

// true when the new values really move the pin or change the radius
const moves = (cur, next) => AREA_KEYS.some((k) => next[k] !== undefined && Number.isFinite(Number(next[k])) && Number(next[k]) !== Number(cur[k]));

// may this request change a LOCKED area? (a superadmin acting for the shop, or a brand owner of the shop's brand)
async function mayChangeLocked(req) {
    if (req.actor && req.actor.type === 'superadmin') return true;
    if (!req.tenant || !req.tenant.brandId || !req.auth || !req.auth.userId) return false;
    const [brand, user] = await Promise.all([
        Brand.findById(req.tenant.brandId).select('ownerPhones').lean(),
        User.findById(req.auth.userId).select('phone').lean(),
    ]);
    return !!(brand && user && (brand.ownerPhones || []).includes(user.phone));
}

// who is changing it now: { who, role, at }
async function by(req) {
    if (req.actor && req.actor.type === 'superadmin') return { who: req.actor.label || 'Superadmin', role: 'superadmin', at: new Date() };
    const user = req.auth && req.auth.userId ? await User.findById(req.auth.userId).select('name phone').lean() : null;
    const phone = user && user.phone ? `${user.phone.slice(0, 2)}XXXXXX${user.phone.slice(-2)}` : '';
    let role = 'owner';
    if (req.tenant && req.tenant.brandId && user) {
        const brand = await Brand.findById(req.tenant.brandId).select('ownerPhones').lean();
        role = brand && (brand.ownerPhones || []).includes(user.phone) ? 'brand owner' : 'branch manager';
    }
    return { who: (user && user.name) || phone || 'Owner', role, at: new Date() };
}

module.exports = { AREA_KEYS, LOCK_MESSAGE, moves, mayChangeLocked, by };
