// Google's "encoded polyline" format (precision 5): a whole route as one short text. The server sends it, the app draws it.
function encode(points) {
    let lastLat = 0;
    let lastLng = 0;
    let out = '';
    const put = (n) => {
        let v = n < 0 ? ~(n << 1) : n << 1;
        while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
        out += String.fromCharCode(v + 63);
    };
    for (const p of points) {
        const lat = Math.round(p.lat * 1e5);
        const lng = Math.round(p.lng * 1e5);
        put(lat - lastLat);
        put(lng - lastLng);
        lastLat = lat;
        lastLng = lng;
    }
    return out;
}

function decode(str) {
    const pts = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
        let result = 0;
        let shift = 0;
        let b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= str.length);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (i < str.length) {
        lat += next();
        lng += next();
        pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return pts;
}

module.exports = { encode, decode };
