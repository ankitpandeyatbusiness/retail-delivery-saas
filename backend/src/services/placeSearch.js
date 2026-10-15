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
// a box of roughly 50 km around a point: { minLon, minLat, maxLon, maxLat }
const boxAround = (near, d = 0.45) => ({ minLon: near.lng - d, minLat: near.lat - d, maxLon: near.lng + d, maxLat: near.lat + d });

/* ---------------------------------- sources ---------------------------------- */
async function googleSources(q, near, strong = false) {
    if (!KEY()) return [];
    const bias = near ? `&location=${near.lat},${near.lng}&radius=${strong ? 25000 : 50000}` : '';
    const out = [];
    const [text, auto, local] = await Promise.allSettled([
        getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${enc(q)}&region=in${bias}&key=${KEY()}`),
        getJson(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${enc(q)}&components=country:in${bias}&key=${KEY()}`),
        // a customer: ALSO ask only inside the area around them, so nearby places are always in the answer
        strong && near
            ? getJson(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${enc(q)}&components=country:in${bias}&strictbounds=true&key=${KEY()}`)
            : Promise.reject(new Error('skip')),
    ]);
    if (local.status === 'fulfilled' && local.value.status === 'OK') {
        for (const p of local.value.predictions || []) {
            out.push({
                src: 'google', placeId: p.place_id, name: p.description,
                title: p.structured_formatting?.main_text || p.description,
                subtitle: p.structured_formatting?.secondary_text || '',
                boost: 0.12,
            });
        }
    }
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

async function photonSource(q, near, opts = {}) {
    let bias = near ? `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=${opts.box ? 0.5 : 0.3}` : '';
    if (opts.box && near) {
        const b = boxAround(near);
        bias += `&bbox=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`;   // only inside the area around the customer
    }
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

async function nominatimSource(q, near, opts = {}) {
    let area = '';
    if (opts.box && near) {
        const b = boxAround(near);
        area = `&viewbox=${b.minLon},${b.maxLat},${b.maxLon},${b.minLat}&bounded=1`;
    }
    const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in${area}&q=${enc(q)}`, { 'User-Agent': UA });
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

// The point (and city / pincode) of a Google suggestion, which only comes with a name at first
async function placeDetails(placeId) {
    if (!KEY()) return null;
    const j = await getJson(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${enc(placeId)}&fields=geometry,formatted_address,address_component&key=${KEY()}`);
    if (j.status !== 'OK' || !j.result) return null;
    const get = (type) => j.result.address_components?.find((c) => c.types.includes(type))?.long_name || '';
    const loc = j.result.geometry?.location;
    if (!loc) return null;
    return {
        name: j.result.formatted_address,
        latitude: loc.lat,
        longitude: loc.lng,
        city: get('locality') || get('administrative_area_level_2'),
        pincode: /^d{6}$/.test(get('postal_code')) ? get('postal_code') : '',
    };
}

/* ---------------------------------- search ---------------------------------- */
// opts (all optional):
//   limit      how many to give back (default 8)
//   proximity  'strong' = places near `near` rank clearly higher (for a customer choosing where to deliver)
//   resolve    look up the point of the first N Google suggestions that came without one, so they can be
//              ranked and measured by distance too
//   bonus      (candidate) => number, added to a candidate's score (e.g. "inside the delivery area")
//   keep       also return each candidate's score
async function search(q, near, opts = {}) {
    const asks = [];
    const strongNear = opts.proximity === 'strong' && near;
    asks.push(googleSources(q, near, !!strongNear));
    for (const v of variants(q)) {
        asks.push(photonSource(v, near));
        if (v === q.trim()) asks.push(nominatimSource(v, near));
    }
    if (strongNear) {
        // the same question asked only inside the ~50 km around the customer: the best matches of ALL India
        // may be far away, and would otherwise crowd the nearby ones out
        asks.push(photonSource(q, near, { box: true }));
        asks.push(nominatimSource(q, near, { box: true }));
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

    // Google suggestions come with a name only: find the point of the best few so they can be measured too
    if (opts.resolve && KEY()) {
        const need = [...seen.values()]
            .filter((c) => c.placeId && c.latitude == null)
            .map((c) => ({ c, r: relevance(q, c) }))
            .sort((a, b) => b.r - a.r)
            .slice(0, opts.resolve);
        await Promise.allSettled(need.map(async ({ c }) => {
            const d = await placeDetails(c.placeId);
            if (d && IN_BOX(d.latitude, d.longitude)) {
                c.latitude = d.latitude; c.longitude = d.longitude;
                c.city = c.city || d.city; c.pincode = c.pincode || d.pincode;
            }
        }));
    }

    const strong = opts.proximity === 'strong';
    const ranked = [...seen.values()].map((c) => {
        const rel = relevance(q, c) + (c.boost || 0);
        let score = rel;
        if (near && c.latitude != null) {
            const d = km(near, { lat: c.latitude, lng: c.longitude });
            // a customer wants what is near them first: the bonus fades over roughly 15 km
            score += strong ? 0.55 * Math.exp(-d / 12) : Math.max(0, 0.2 - d / 500);
        }
        if (opts.bonus) score += opts.bonus(c) || 0;
        // being close never makes a place that does not match the typed words a match
        return { ...c, score, rel };
    }).filter((c) => (strong ? c.rel >= 0.35 : c.score >= 0.35)).sort((a, b) => b.score - a.score);

    return ranked.slice(0, opts.limit || 8).map(({ src, boost, score, rel, ...c }) => (opts.keep ? { ...c, score } : c));
}

module.exports = { search, relevance, wordSimilarity, placeDetails, KEY, getJson, UA };
