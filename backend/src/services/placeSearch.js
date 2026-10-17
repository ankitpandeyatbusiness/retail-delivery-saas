// Place search that behaves like a person looking for a shop: "city fashion sultanpur" finds City Fashion in
// Sultanpur even with a small spelling mistake, a missing word or words in another order.
//
// Several sources are asked at the same time and their answers are merged and RANKED here:
//   Google Places API (New): autocomplete + text search by name (when the server has GOOGLE_PLACES_SERVER_KEY)
//   Photon (OpenStreetMap, fuzzy)  and  Nominatim
// India only: every source is limited to India and a result outside India's box is dropped.
// The server's own key (Places API (New) + Geocoding API enabled, NOT restricted to an app). The older names still work.
const KEY = () => process.env.GOOGLE_PLACES_SERVER_KEY || process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const { LRUCache } = require('lru-cache');
const budget = require('./googleBudget');
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

async function postJson(url, body, headers = {}, ms = 6000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
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
// What Google answered for a typed text, kept for 10 minutes: the same words asked again (the same town, the same
// landmark) cost nothing. Only the Google part is kept; ranking is done fresh for every request.
const googleCache = new LRUCache({ max: 500, ttl: 10 * 60 * 1000 });
const G_PLACES = 'https://places.googleapis.com/v1';

// share: how much of the monthly allowance this caller may use (1 = all; the superadmin's own searches use half)
async function googleSources(q, near, strong = false, share = 1) {
    if (!KEY()) return [];
    const ckey = [norm(q), near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '-', strong ? 's' : 'n', share].join('|');
    const hit = googleCache.get(ckey);
    if (hit) return hit;

    const key = { 'X-Goog-Api-Key': KEY() };
    const circle = near ? { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: strong ? 25000 : 50000 } } : null;
    const box = near ? (() => { const b = boxAround(near); return { rectangle: { low: { latitude: b.minLat, longitude: b.minLon }, high: { latitude: b.maxLat, longitude: b.maxLon } } }; })() : null;
    const spend = async (sku, call) => { if (!(await budget.take(sku, { share }))) throw new Error('skip'); return call(); };

    const [text, auto, local] = await Promise.allSettled([
        // 1. the best answer for shop names (Pro price): only while the month's allowance lasts
        spend('text_search', () => postJson(`${G_PLACES}/places:searchText`,
            { textQuery: q, regionCode: 'IN', ...(circle ? { locationBias: circle } : {}) },
            { ...key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location' })),
        // 2. suggestions as it is typed (Essentials price)
        spend('autocomplete', () => postJson(`${G_PLACES}/places:autocomplete`,
            { input: q, includedRegionCodes: ['in'], ...(circle ? { locationBias: circle } : {}) }, key)),
        // a customer: ALSO ask only inside the area around them, so nearby places are always in the answer
        strong && near
            ? spend('autocomplete', () => postJson(`${G_PLACES}/places:autocomplete`, { input: q, includedRegionCodes: ['in'], locationRestriction: box }, key))
            : Promise.reject(new Error('skip')),
    ]);

    const out = [];
    const suggestions = (r, boost) => {
        if (r.status !== 'fulfilled') return;
        for (const x of r.value.suggestions || []) {
            const pp = x.placePrediction;
            if (!pp) continue;
            out.push({
                src: 'google', placeId: pp.placeId || String(pp.place || '').replace(/^places\//, ''),
                name: pp.text?.text || '',
                title: pp.structuredFormat?.mainText?.text || pp.text?.text || '',
                subtitle: pp.structuredFormat?.secondaryText?.text || '',
                boost,
            });
        }
    };
    suggestions(local, 0.12);
    if (text.status === 'fulfilled') {
        for (const r of text.value.places || []) {
            const name = r.displayName?.text || '';
            const addr = r.formattedAddress || '';
            out.push({
                src: 'google', placeId: r.id, title: name, name: `${name}, ${addr}`,
                subtitle: addr.replace(/, India$/, ''),
                latitude: r.location?.latitude, longitude: r.location?.longitude,
                boost: 0.15,
            });
        }
    }
    suggestions(auto, 0.1);
    if (out.length) googleCache.set(ckey, out);
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

// The point (and city / pincode) of a Google suggestion, which only comes with a name at first.
// Only the Essentials fields are asked for (address, point, parts), which keeps it at the cheap price.
// null = no allowance left this month (the caller uses a free source) or Google had nothing.
async function placeDetails(placeId) {
    if (!KEY()) return null;
    if (!(await budget.take('details'))) return null;
    const j = await getJson(`${G_PLACES}/places/${enc(placeId)}`, { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'formattedAddress,location,addressComponents' });
    const loc = j?.location;
    if (!loc || !Number.isFinite(loc.latitude)) return null;
    const get = (type) => j.addressComponents?.find((c) => c.types?.includes(type))?.longText || '';
    return {
        name: j.formattedAddress,
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: get('locality') || get('administrative_area_level_2'),
        pincode: /^\d{6}$/.test(get('postal_code')) ? get('postal_code') : '',
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
    asks.push(googleSources(q, near, !!strongNear, opts.share ?? 1));
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

    // a Google suggestion has no point until Details is asked: with no allowance left it could not be opened, so it is left out
    const detailsLeft = !KEY() || await budget.hasLeft('details');
    const strong = opts.proximity === 'strong';
    const ranked = [...seen.values()].filter((c) => detailsLeft || !(c.placeId && c.latitude == null)).map((c) => {
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

module.exports = { search, relevance, wordSimilarity, placeDetails, KEY, getJson, postJson, UA, googleCache };
