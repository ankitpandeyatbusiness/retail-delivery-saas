// The rider's marker on a customer / owner map, sliding ALONG THE ROAD between two positions instead of cutting straight across.
//
//   const g = useRoadGlide({ road, loc, resetKey });
//   road      the route as [{ latitude, longitude }] (empty when there is no real road: then the marker glides in a straight line)
//   loc       the latest position { lat, lng, heading? } (new numbers = a new ping)
//   resetKey  a different value (the order id) starts everything again
//   -> g.coordinate  an AnimatedRegion: give it to <Marker.Animated coordinate={g.coordinate}>; it is moved a few times a second
//      g.ready       true once the first position is known (render the marker only then)
//      g.heading     the way the marker is moving, in degrees, eased so the badge turns smoothly (null until known)
//      g.line        the road still AHEAD of the marker, starting at the marker (null when there is no road): draw this
//      g.pos         where the marker is right now
//
// A ping is a point on the road a few seconds ahead. The marker travels the road between where it is and that point, taking about
// as long as the pings come apart, so it keeps moving and arrives when the next ping does. If the ping is not on the road (or the
// road between is much longer than the straight way, a U-turn or a wrong snap) it glides straight.
import { useEffect, useRef, useState } from 'react';
import { AnimatedRegion } from 'react-native-maps';

const rad = (x) => (x * Math.PI) / 180;
const metres = (a, b) => {
    const dy = (b.latitude - a.latitude) * 110540;
    const dx = (b.longitude - a.longitude) * 111320 * Math.cos(rad((a.latitude + b.latitude) / 2));
    return Math.hypot(dx, dy);
};
const bearing = (a, b) => {
    const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
    const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
    return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};
const nearest = (road, p, from, to) => {
    const k = Math.cos(rad(p.latitude));
    let best = from;
    let bd = Infinity;
    for (let i = from; i <= to; i += 1) {
        const dy = road[i].latitude - p.latitude;
        const dx = (road[i].longitude - p.longitude) * k;
        const d = dy * dy + dx * dx;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
};
// the closest point to p on the piece a-b
const onPiece = (a, b, p) => {
    const k = Math.cos(rad(p.latitude));
    const ax = a.longitude * k; const ay = a.latitude;
    const dx = b.longitude * k - ax; const dy = b.latitude - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.longitude * k - ax) * dx + (p.latitude - ay) * dy) / len)) : 0;
    return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
};
export const bearingBetween = bearing;
// the way the road runs just ahead of a point on it (about 15 m on): the way the scooter should face before it has moved
const roadHeading = (r, pos, idx) => {
    let j = Math.min(r.length - 1, idx + 1);
    while (j < r.length - 1 && metres(pos, r[j]) < 15) j += 1;
    return metres(pos, r[j]) > 1 ? bearing(pos, r[j]) : null;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// turn from angle a towards angle b by `k` of the shortest way round
const ease = (a, b, k) => (a + k * ((((b - a) % 360) + 540) % 360 - 180) + 360) % 360;

export function useRoadGlide({ road, loc, resetKey }) {
    const [view, setView] = useState({ ready: false, heading: null, line: null, pos: null });
    const coordinate = useRef(new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0 })).current;
    const st = useRef({ pos: null, idx: 0, heading: null, lastAt: 0, timer: null });
    const roadRef = useRef(road);
    roadRef.current = road;

    const lineOf = () => {
        const s = st.current;
        const r = roadRef.current;
        return s.pos && r && r.length > 1 ? [s.pos, ...r.slice(s.idx + 1)] : null;
    };
    const publish = () => { const s = st.current; setView({ ready: !!s.pos, heading: s.heading, line: lineOf(), pos: s.pos }); };
    const stop = () => { if (st.current.timer) { clearInterval(st.current.timer); st.current.timer = null; } };

    // a different order: forget the position
    useEffect(() => {
        stop();
        st.current = { pos: null, idx: 0, heading: null, lastAt: 0, timer: null };
        setView({ ready: false, heading: null, line: null, pos: null });
        return stop;
    }, [resetKey]);   // eslint-disable-line react-hooks/exhaustive-deps

    // a new road (the first one, or the server drew a new one): find where the marker is on it
    useEffect(() => {
        const s = st.current;
        if (s.pos && road && road.length > 1) {
            s.idx = nearest(road, s.pos, 0, road.length - 1);
            if (!s.timer) s.heading = roadHeading(road, s.pos, s.idx) ?? s.heading;
        }
        if (s.pos) publish();
    }, [road]);   // eslint-disable-line react-hooks/exhaustive-deps

    // a new ping
    useEffect(() => {
        if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
        const s = st.current;
        const r = roadRef.current;
        const roadOk = r && r.length > 1;
        const target = { latitude: loc.lat, longitude: loc.lng };
        const now = Date.now();
        const gapMs = s.lastAt ? now - s.lastAt : 0;
        s.lastAt = now;
        stop();

        if (!s.pos) {   // the first position: the marker is simply there
            s.pos = target;
            s.heading = null;   // the heading the server sends is often 0 when the phone does not know it: never trusted, it pointed the scooter north
            if (roadOk) { s.idx = nearest(r, target, 0, r.length - 1); s.heading = roadHeading(r, target, s.idx) ?? s.heading; }
            coordinate.setValue({ latitude: target.latitude, longitude: target.longitude, latitudeDelta: 0, longitudeDelta: 0 });
            publish();
            return;
        }

        // the path to travel: along the road when the ping is on it, ahead of the marker, and the road is not much longer than the straight way
        let path = [s.pos, target];
        const idxStart = s.idx;
        let usedRoad = false;
        if (roadOk) {
            const j = nearest(r, target, Math.max(0, s.idx - 2), Math.min(r.length - 1, s.idx + 600));
            if (metres(target, r[j]) < 60) {
                const pieces = [[j - 1, j], [j, j + 1]].filter(([a, b]) => a >= 0 && b < r.length).map(([a, b]) => ({ a, p: onPiece(r[a], r[b], target) }));
                const best = pieces.sort((x, y) => metres(target, x.p) - metres(target, y.p))[0];
                if (best && best.a >= s.idx) {
                    const viaRoad = [s.pos, ...r.slice(s.idx + 1, best.a + 1), best.p];
                    const len = viaRoad.reduce((m, p, i) => (i ? m + metres(viaRoad[i - 1], p) : 0), 0);
                    const straight = metres(s.pos, best.p);
                    if (len <= Math.max(straight * 2.5, straight + 150)) { path = viaRoad; usedRoad = true; }
                }
            }
        }
        const cum = [0];
        for (let i = 1; i < path.length; i += 1) cum.push(cum[i - 1] + metres(path[i - 1], path[i]));
        const L = cum[cum.length - 1];
        if (!(L > 1)) { s.pos = target; coordinate.setValue({ latitude: target.latitude, longitude: target.longitude, latitudeDelta: 0, longitudeDelta: 0 }); publish(); return; }

        // travelling takes about as long as the pings are apart (so it arrives when the next one does)
        const D = clamp((gapMs || 3000) * 0.92, 1500, 9500);
        const t0 = Date.now();
        let tick = 0;
        s.timer = setInterval(() => {
            const f = Math.min(1, (Date.now() - t0) / D);
            const d = f * L;
            let seg = 0;
            while (seg < path.length - 2 && cum[seg + 1] < d) seg += 1;
            const len = cum[seg + 1] - cum[seg];
            const t = len > 0 ? (d - cum[seg]) / len : 1;
            const a = path[seg];
            const b = path[seg + 1];
            const p = { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
            s.pos = p;
            if (len > 1) s.heading = s.heading == null ? bearing(a, b) : ease(s.heading, bearing(a, b), 0.35);   // eased: the badge turns, it does not snap
            if (usedRoad) s.idx = idxStart + seg;
            coordinate.timing({ latitude: p.latitude, longitude: p.longitude, latitudeDelta: 0, longitudeDelta: 0, duration: 130, useNativeDriver: false }).start();
            tick += 1;
            if (tick % 2 === 0 || f === 1) publish();   // the route line is cut at the marker twice a second; the badge turns with it
            if (f === 1) stop();
        }, 120);
    }, [loc?.lat, loc?.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    return { coordinate, ...view };
}
