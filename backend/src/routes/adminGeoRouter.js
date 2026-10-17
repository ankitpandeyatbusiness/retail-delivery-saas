// Superadmin: place search for the "point on the map" screen. Mounted under /api/admin.
//   GET /geo/search?q=...&lat=&lng=   the most relevant places in India for what was typed (see services/placeSearch.js)
//   GET /geo/place?id=...             the point of a Google suggestion
//   GET /geo/reverse?lat=&lng=        the address of a point
// The Google key stays on the server: a phone never sees it.
const express = require('express');
const { wrap, httpError } = require('../middlewares/apiErrors');
const places = require('../services/placeSearch');

const router = express.Router();
const enc = encodeURIComponent;
const { KEY, getJson, UA } = places;   // the Geocoding API (address of a pin) uses the same server key

const place = (name, lat, lng, extra = {}) => ({ name, latitude: Number(lat), longitude: Number(lng), ...extra });

function fromGoogle(r) {
    const get = (type) => r.address_components?.find((c) => c.types.includes(type))?.long_name || '';
    return place(r.formatted_address, r.geometry.location.lat, r.geometry.location.lng, {
        city: get('locality') || get('administrative_area_level_2'),
        pincode: /^\d{6}$/.test(get('postal_code')) ? get('postal_code') : '',
    });
}

function fromOsm(r) {
    const a = r.address || {};
    return place(r.display_name, r.lat, r.lon, {
        city: a.city || a.town || a.village || a.county || '',
        pincode: /^\d{6}$/.test(a.postcode || '') ? a.postcode : '',
    });
}

async function reverse(lat, lng) {
    if (KEY()) {
        try {
            const j = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${KEY()}`);
            if (j.status === 'OK' && j.results?.length) return fromGoogle(j.results[0]);
        } catch { /* next */ }
    }
    const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`, { 'User-Agent': UA });
    return j && j.lat ? fromOsm(j) : null;
}

router.get('/geo/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q.length < 3) throw httpError(400, 'Type at least 3 letters');
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const near = req.query.lat !== undefined && req.query.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    try { res.json({ items: await places.search(q, near, { share: 0.5 }) }); } catch { throw httpError(502, 'Place search is not reachable right now'); }
}));

router.get('/geo/place', wrap(async (req, res) => {
    const id = String(req.query.id || '');
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(id) || !KEY()) throw httpError(400, 'Invalid place');
    let p = null;
    try { p = await places.placeDetails(id); } catch { /* below */ }
    if (!p) throw httpError(502, 'Could not open this place');
    res.json({ place: p });
}));

router.get('/geo/reverse', wrap(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw httpError(400, 'Invalid point');
    try { res.json({ place: await reverse(lat, lng) }); } catch { res.json({ place: null }); }
}));

module.exports = router;
