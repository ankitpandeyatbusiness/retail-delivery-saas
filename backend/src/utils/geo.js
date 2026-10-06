const rad = (d) => (d * Math.PI) / 180;

// Straight-line distance in km (good enough for a delivery radius)
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Is this point inside the shop's delivery area?
// If the shop has no location/radius set, delivery is allowed everywhere.
function serviceability(tenant, lat, lng) {
    const d = tenant.delivery || {};
    const hasRule = [d.latitude, d.longitude, d.radiusKm].every((n) => Number.isFinite(n)) && d.radiusKm > 0;
    if (!hasRule) return { serviceable: true, distanceKm: null, radiusKm: d.radiusKm ?? null, message: null };

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { serviceable: false, distanceKm: null, radiusKm: d.radiusKm, message: 'Please pin your location on the map so we can check delivery' };
    }
    const km = Math.round(haversineKm(d.latitude, d.longitude, lat, lng) * 10) / 10;
    if (km <= d.radiusKm) return { serviceable: true, distanceKm: km, radiusKm: d.radiusKm, message: null };
    return {
        serviceable: false, distanceKm: km, radiusKm: d.radiusKm,
        message: `Sorry, we deliver only within ${d.radiusKm} km (you are ${km} km away)`,
    };
}

module.exports = { haversineKm, serviceability };