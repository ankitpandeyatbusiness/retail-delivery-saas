// "Where should we deliver?": place search for the customer's map screen. Mounted under /api/geo.
//   GET /suggest?q=&lat=&lng=   places in India for what was typed, nearest to the customer first, each with
//                               its distance and whether this shop delivers there
//   GET /place?id=              the point of a Google suggestion that came without one
// Works before login (the map is used before sign-in), so it is rate limited by IP.
// The Google key stays on the server: a phone never sees it.
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const { wrap, httpError } = require('../middlewares/apiErrors');
const places = require('../services/placeSearch');
const { haversineKm, serviceability } = require('../utils/geo');

const router = express.Router();
router.use(tenantRecognizer);

const finite = (v) => v !== undefined && v !== '' && Number.isFinite(Number(v));
const round1 = (n) => Math.round(n * 10) / 10;

// Where to measure "near" from: the customer's own position, else the map's centre, else the shop itself
function origin(req) {
    if (finite(req.query.lat) && finite(req.query.lng)) {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng, from: 'you' };
    }
    const d = req.tenant.delivery || {};
    if (Number.isFinite(d.latitude) && Number.isFinite(d.longitude)) return { lat: d.latitude, lng: d.longitude, from: 'shop' };
    return null;
}

router.get('/suggest', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q.length < 2) throw httpError(400, 'Type at least 2 letters');
    const near = origin(req);
    const tenant = req.tenant;
    const hasArea = (() => {
        const d = tenant.delivery || {};
        return [d.latitude, d.longitude, d.radiusKm].every((n) => Number.isFinite(n)) && d.radiusKm > 0;
    })();

    let items;
    try {
        items = await places.search(q, near && { lat: near.lat, lng: near.lng }, {
            limit: 8,
            proximity: 'strong',
            resolve: 2,   // only the best two get their point looked up now (each is a billed Details call); the rest on tap
            // an address the shop can deliver to is worth more than one it cannot
            bonus: (c) => (hasArea && c.latitude != null && serviceability(tenant, c.latitude, c.longitude).serviceable ? 0.25 : 0),
        });
    } catch { throw httpError(502, 'Place search is not reachable right now'); }

    res.json({
        from: near ? near.from : null,
        items: items.map((c) => {
            const hasPoint = c.latitude != null && c.longitude != null;
            const out = { ...c };
            out.distanceKm = near && hasPoint ? round1(haversineKm(near.lat, near.lng, c.latitude, c.longitude)) : null;
            // null = the shop has no delivery area (delivers everywhere) or the point is not known yet
            out.deliverable = (hasArea || tenant.brandId) && hasPoint ? serviceability(tenant, c.latitude, c.longitude).serviceable : null;
            return out;
        }),
    });
}));

router.get('/place', wrap(async (req, res) => {
    const id = String(req.query.id || '');
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(id) || !places.KEY()) throw httpError(400, 'Invalid place');
    let p = null;
    try { p = await places.placeDetails(id); } catch { /* below */ }
    if (!p) throw httpError(502, 'Could not open this place');
    const s = serviceability(req.tenant, p.latitude, p.longitude);
    res.json({ place: { ...p, deliverable: s.distanceKm === null && s.serviceable ? null : s.serviceable } });
}));

// Which branch of this brand delivers to the customer's spot? Only branches with a pin AND a radius that cover the point, nearest first.
// The app's own shop (x-tenant-slug) tells us the brand. A shop that is not a branch answers with just itself.
router.get('/branches', wrap(async (req, res) => {
    if (!finite(req.query.lat) || !finite(req.query.lng)) throw httpError(400, 'Send lat and lng');
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw httpError(400, 'Invalid location');
    const me = req.tenant;
    if (!me.brandId) {
        const s = serviceability(me, lat, lng);
        return res.json({ brand: null, current: me.slug, branches: s.serviceable ? [{ slug: me.slug, name: me.name, city: null, distanceKm: s.distanceKm }] : [] });
    }
    const Tenant = require('../models/Tenant');
    const Brand = require('../models/Brand');
    const [brand, all] = await Promise.all([
        Brand.findById(me.brandId).select('name').lean(),
        Tenant.find({ brandId: me.brandId, status: 'active' }).select('slug name branchCity address.city logo delivery').lean(),
    ]);
    const branches = all
        .map((t) => ({ t, s: serviceability(t, lat, lng) }))
        .filter((x) => x.s.serviceable && x.s.distanceKm !== null)   // a branch with no radius is never shown
        .sort((a, b) => a.s.distanceKm - b.s.distanceKm)
        .map(({ t, s }) => ({ slug: t.slug, name: t.name, city: t.branchCity || (t.address && t.address.city) || null, logo: t.logo || null, distanceKm: s.distanceKm }));
    res.json({ brand: brand ? { name: brand.name } : null, current: me.slug, branches });
}));

module.exports = router;
