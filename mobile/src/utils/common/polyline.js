// Google's "encoded polyline" text -> [{ latitude, longitude }] (precision 5). The server sends the road line in this form.
export function decodePolyline(str) {
    if (typeof str !== 'string' || !str) return [];
    const out = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    while (i < str.length) {
        for (let k = 0; k < 2; k += 1) {
            let shift = 0;
            let result = 0;
            let b;
            do {
                if (i >= str.length) return out;
                b = str.charCodeAt(i++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            const d = result & 1 ? ~(result >> 1) : result >> 1;
            if (k === 0) lat += d; else lng += d;
        }
        out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return out;
}
