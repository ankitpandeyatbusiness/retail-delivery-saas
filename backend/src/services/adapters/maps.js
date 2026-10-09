// Maps adapter: distance and ETA.
//
//   const mins = await maps.etaMinutes({ from: { lat, lng }, to: { lat, lng } });
//
// MAPS_PROVIDER=straight (default) -> straight-line distance and average speed. Free, no key.
// MAPS_PROVIDER=google             -> Google Distance Matrix (later, optional upgrade).
// The map DRAWING happens in the app. This file is only for the server's numbers.

const AVG_SPEED_KMH = parseFloat(process.env.RIDER_AVG_SPEED_KMH) || 20;

function haversineKm(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(x));
}

const straightProvider = {
    async etaMinutes({ from, to }) {
        const km = haversineKm(from, to) * 1.3;   // roads are longer than a straight line
        return { minutes: Math.max(1, Math.round((km / AVG_SPEED_KMH) * 60)), km: Math.round(km * 10) / 10 };
    },
};

const googleProvider = {
    async etaMinutes() {
        // LATER: call Google Distance Matrix here
        throw new Error('Google maps provider not configured');
    },
};

const provider = () => (process.env.MAPS_PROVIDER === 'google' ? googleProvider : straightProvider);

module.exports = { etaMinutes: (args) => provider().etaMinutes(args), haversineKm };