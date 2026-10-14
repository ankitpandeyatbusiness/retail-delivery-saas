// Place search that behaves like a person looking for a shop: "city fashion sultanpur" finds City Fashion in
// Sultanpur even with a small spelling mistake, a missing word or words in another order.
//
// Several sources are asked at the same time and their answers are merged and RANKED here:
//   Google Places text search + autocomplete (when the server has GOOGLE_MAPS_API_KEY)
//   Photon (OpenStreetMap, fuzzy)  and  Nominatim
// India only: every source is limited to India and a result outside India's box is dropped.
const KEY = () => process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const UA = 'RetailControl/1.0 (superadmin place search)';
const enc = encodeURIComponent;

async function getJson(url, headers = {}, ms = 6000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
        const res = await fetch(url, { headers, signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally { clearTimeout(timer); }
}

/* ---------------------------------- text matching ---------------------------------- */
const STOP = new Set(['the', 'and', 'in', 'at', 'of', 'near', 'shop', 'store']);
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        for (let j = 1; j <= b.length; j += 1) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

// 1 = same word, ~0.9 = typed the beginning of it, otherwise how close the spelling is (0 when far apart)
function wordSimilarity(q, w) {
    if (q === w) return 1;
    if (w.startsWith(q) && q.length >= 2) return 0.9;
    if (q.length < 3 || w.length < 3) return 0;
    const d = lev(q, w);
    const allowed = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    if (d > allowed) {
        // the typed word may be the beginning of the real one with a slip in it
        const head = w.slice(0, q.length);
        const dh = lev(q, head);
        return dh <= 1 && q.length >= 4 ? 0.7 : 0;
    }
    return Math.max(0.5, 1 - d / Math.max(q.length, w.length));
}

// how well a candidate answers the typed text: name words count more than address words
function relevance(query, c) {
    const q = tokens(query);
    if (!q.length) return 0;
    const nameT = tokens(c.title);
    const addrT = tokens(`${c.subtitle} ${c.name}`);
    let total = 0;
    let hit = 0;
    for (const w of q) {
        let best = 0;
        for (const x of nameT) best = Math.max(best, wordSimilarity(w, x) * 1.0);
        for (const x of addrT) best = Math.max(best, wordSimilarity(w, x) * 0.7);
        total += best;
        if (best > 0) hit += 1;
    }
    let score = total / q.length;
    if (hit === q.length) score += 0.25;                               // every word explained
    const joinedName = norm(c.title);
    if (joinedName === norm(query)) score += 0.4;
    else if (joinedName.startsWith(norm(query))) score += 0.2;
    return score;
}

const IN_BOX = (lat, lng) => lat >= 6 && lat <= 37.6 && lng >= 68 && lng <= 97.6;
const km = (a, b) => {
    const r = (d) => (d * Math.PI) / 180;
    const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
};
const uniq = (list) => [...new Set(list.filter(Boolean))];

/* ---------------------------------- sources ---------------------------------- */
async function googleSources(q, near) {
    if (!KEY()) return [];
    const bias = near ? `&location=${near.lat},${near.lng}&radius=50000` : '';
    const out = [];
    const [text, auto] = await Promise.allSettled([
        getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${enc(q)}&region=in${bias}&key=${KEY()}`),
        getJson(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${enc(q)}&components=country:in${bias}&key=${KEY()}`),
    ]);
    if (text.status === 'fulfilled' && text.value.status === 'OK') {
        for (const r of text.value.results || []) {
            const addr = r.formatted_address || '';
            out.push({
                src: 'google', placeId: r.place_id, title: r.name, name: `${r.name}, ${addr}`,
                subtitle: addr.replace(/, India$/, ''),
                latitude: r.geometry?.location?.lat, longitude: r.geometry?.location?.lng,
                boost: 0.15,
            });
        }
    }
    if (auto.status === 'fulfilled' && auto.value.status === 'OK') {
        for (const p of auto.value.predictions || []) {
            out.push({
                src: 'google', placeId: p.place_id, name: p.description,
                title: p.structured_formatting?.main_text || p.description,
                subtitle: p.structured_formatting?.secondary_text || '',
                boost: 0.1,
            });
        }
    }
    return out;
}

async function photonSource(q, near) {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
    const j = await getJson(`https://photon.komoot.io/api/?q=${enc(q)}&limit=10&lang=en${bias}`, { 'User-Agent': UA });
    return (j.features || [])
        .filter((f) => !f.properties?.countrycode || f.properties.countrycode === 'IN')
        .map((f) => {
            const p = f.properties || {};
            const city = p.city || p.county || '';
            return {
                src: 'photon',
                name: uniq([p.name, p.street, p.district, city, p.state]).join(', '),
                title: p.name || p.street || city,
                subtitle: uniq([p.street, p.district, city, p.state]).join(', '),
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                city,
                pincode: /^\d{6}$/.test(p.postcode || '') ? p.postcode : '',
            };
        });
}

async function nominatimSource(q) {
    const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in&q=${enc(q)}`, { 'User-Agent': UA });
    return (Array.isArray(j) ? j : []).map((r) => {
        const a = r.address || {};
        const parts = String(r.display_name || '').split(',').map((x) => x.trim());
        return {
            src: 'osm',
            name: r.display_name,
            title: r.name || parts[0],
            subtitle: parts.slice(1, 4).join(', '),
            latitude: Number(r.lat),
            longitude: Number(r.lon),
            city: a.city || a.town || a.village || a.county || '',
            pincode: /^\d{6}$/.test(a.postcode || '') ? a.postcode : '',
        };
    });
}

// Words a person may have left out or run together: also try the first words alone and the last word as the place.
function variants(q) {
    const t = norm(q).split(' ').filter(Boolean);
    const out = new Set([q.trim()]);
    if (t.length >= 3) {
        out.add(t.slice(0, -1).join(' '));                       // "city fashion"
        out.add(`${t.slice(0, -1).join(' ')} ${t[t.length - 1]}`);
    }
    if (t.length === 1 && t[0].length >= 6) out.add(`${t[0].slice(0, 4)} ${t[0].slice(4)}`);   // "cityfashion" -> "city fashion"
    return [...out].slice(0, 3);
}

/* ---------------------------------- search ---------------------------------- */
async function search(q, near) {
    const asks = [];
    asks.push(googleSources(q, near));
    for (const v of variants(q)) {
        asks.push(photonSource(v, near));
        if (v === q.trim()) asks.push(nominatimSource(v));
    }
    const settled = await Promise.allSettled(asks);
    let all = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);
    if (!all.length && settled.every((s) => s.status === 'rejected')) throw new Error('no place source reachable');

    // India only
    all = all.filter((c) => (c.latitude == null || c.longitude == null) || IN_BOX(c.latitude, c.longitude));

    // merge the same place found by several sources
    const seen = new Map();
    for (const c of all) {
        const key = c.placeId || `${norm(c.title)}|${c.latitude != null ? c.latitude.toFixed(3) : ''}|${c.longitude != null ? c.longitude.toFixed(3) : ''}`;
        const have = seen.get(key);
        if (!have || (c.boost || 0) > (have.boost || 0)) seen.set(key, c);
    }

    const ranked = [...seen.values()].map((c) => {
        let score = relevance(q, c) + (c.boost || 0);
        if (near && c.latitude != null) score += Math.max(0, 0.2 - km(near, { lat: c.latitude, lng: c.longitude }) / 500);   // a little for being close
        return { ...c, score };
    }).filter((c) => c.score >= 0.35).sort((a, b) => b.score - a.score);

    return ranked.slice(0, 8).map(({ src, boost, score, ...c }) => c);
}

module.exports = { search, relevance, wordSimilarity, KEY, getJson, UA };
