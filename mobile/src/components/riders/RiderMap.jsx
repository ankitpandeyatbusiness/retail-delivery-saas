// The rider's map: the way to the customer at a glance (Google Maps does the driving: the button under the map opens it).
// The map starts turned so the way runs LEFT to right, with the whole road inside the box and a margin around it, and the distance
// is written on it.
//   before the food is collected   the road from the shop to the customer, with the whole distance
//   on his way (live = true)       the road from where he is now to the customer; the part he has passed is erased as he moves,
//                                  and the distance left and the tentative arrival time are kept up to date
// He can slide, zoom, turn and tilt it with his fingers.
//   compass (top right)   always shown. The needle follows the phone's compass sensor, so its red end points to real north whichever
//                         way he holds the phone. A tap turns the map north-up (north at the top, tilt off).
//   (the sensor only moves the needle: nothing but his own fingers, or the compass tap, turns the map)
//   reset (bottom left)   back to the starting view: the whole road inside the box, with its margin.
//   maximize (bottom right)   the map full screen; the same button brings it back.
// route = { source: 'google' | 'estimate', polyline, distanceM? }. A dashed line is the free estimate.
// His own position is only used to cut the line (no arrow is drawn). The shop's pin is never drawn.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Platform, Pressable, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { decodePolyline } from '../../utils/common/polyline';
import { tr } from '../../i18n';

const ok = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
const norm = (a) => ((a % 360) + 360) % 360;
const km = (a, b) => {
    const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
};
const bearing = (a, b) => {
    const r = (x) => (x * Math.PI) / 180;
    const y = Math.sin(r(b.longitude - a.longitude)) * Math.cos(r(b.latitude));
    const x = Math.cos(r(a.latitude)) * Math.sin(r(b.latitude)) - Math.sin(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.cos(r(b.longitude - a.longitude));
    return norm((Math.atan2(y, x) * 180) / Math.PI);
};
const nearest = (line, p, from = 0, to = line.length - 1) => {
    const k = Math.cos((p.latitude * Math.PI) / 180);
    let best = from;
    let bd = Infinity;
    for (let i = from; i <= to; i += 1) {
        const dy = line[i].latitude - p.latitude;
        const dx = (line[i].longitude - p.longitude) * k;
        const d = dy * dy + dx * dx;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
};
// the closest point to p on the piece a-b
const onPiece = (a, b, p) => {
    const k = Math.cos((p.latitude * Math.PI) / 180);
    const ax = a.longitude * k; const ay = a.latitude;
    const dx = b.longitude * k - ax; const dy = b.latitude - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.longitude * k - ax) * dx + (p.latitude - ay) * dy) / len)) : 0;
    return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
};
const lengthM = (line) => { let m = 0; for (let i = 1; i < line.length; i += 1) m += km(line[i - 1], line[i]) * 1000; return m; };
const nice = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

/* ------------------------------ the compass needle ------------------------------ */
// Points to real north: it is turned by -(the way the phone faces), taken from the phone's compass sensor. A turn goes the short way
// round and runs on the phone's UI thread, so it moves smoothly. Without a sensor it shows north of the map instead (mapHeading).
function Needle({ mapHeading }) {
    const [facing, setFacing] = useState(null);
    useEffect(() => {
        let sub = null;
        let dead = false;
        let last = -1;
        let at = 0;
        (async () => {
            try {
                let p = await Location.getForegroundPermissionsAsync();
                if (!p.granted && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
                if (!p.granted || dead) return;
                sub = await Location.watchHeadingAsync((h) => {
                    const raw = h?.trueHeading >= 0 ? h.trueHeading : h?.magHeading;
                    const now = Date.now();
                    if (dead || !Number.isFinite(raw) || now - at < 100) return;
                    // a low-pass filter on the circle: the sensor's noise is smoothed out and a real turn still follows
                    const v = last < 0 ? raw : norm(last + 0.4 * (((raw - last + 540) % 360) - 180));
                    if (last >= 0 && Math.abs(((v - last + 540) % 360) - 180) < 1) return;
                    last = v; at = now;
                    setFacing(v);
                });
                if (dead) sub.remove();
            } catch (e) { /* no compass on this phone: the map's own north is shown */ }
        })();
        return () => { dead = true; sub?.remove?.(); };
    }, []);

    const deg = facing != null ? -facing : -(mapHeading || 0);
    const v = useRef(new Animated.Value(deg)).current;
    const lastDeg = useRef(deg);
    useEffect(() => {
        let d = norm(deg) - norm(lastDeg.current);
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        const to = lastDeg.current + d;
        lastDeg.current = to;
        Animated.timing(v, { toValue: to, duration: 120, easing: Easing.linear, useNativeDriver: true }).start();
    }, [deg, v]);
    const rotate = v.interpolate({ inputRange: [-100000, 100000], outputRange: ['-100000deg', '100000deg'] });
    return (
        <Animated.View style={[s.needle, { transform: [{ rotate }] }]}>
            <Text style={s.north}>N</Text>
            <View style={s.needleN} />
            <View style={s.needleS} />
        </Animated.View>
    );
}

/* ------------------------------ the map itself (in the box, or full screen) ------------------------------ */
function MapPane({ line, start, end, destination, estimate, live, label, startLabel, endLabel, metres, etaMin, full, onToggle, topInset = 0, onGesture }) {
    const { primary, border, surface, muted, text } = useBrand();
    const map = useRef(null);
    const ready = useRef(false);
    const programmatic = useRef(0);    // when our own camera move ends, that is not a hand gesture
    const userMoved = useRef(false);   // he moved or zoomed the map himself: it is left alone until he taps reset
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [moved, setMoved] = useState(false);
    const [cam, setCam] = useState({ heading: 0, pitch: 0 });   // how the map is turned and tilted right now (for the compass)
    const [track, setTrack] = useState(true);   // a custom pin is drawn again only when its text changes (cheaper)
    useEffect(() => { setTrack(true); const t = setTimeout(() => setTrack(false), 800); return () => clearTimeout(t); }, [label, startLabel, endLabel, primary]);

    const touched = () => { userMoved.current = true; setMoved(true); };
    const readCamera = () => map.current?.getCamera?.().then((c) => { if (c) setCam({ heading: c.heading || 0, pitch: c.pitch || 0 }); }).catch(() => { });

    // Turn the map so the way runs left to right (the customer on the right) and zoom so the WHOLE road, bends included, sits inside
    // the box with a wide margin (the name tags hang out about 80 px on each side of their points). The road is measured in the
    // turned frame: along the way (across the box) and sideways.
    const aim = useMemo(() => {
        if (!ok(start) || !ok(end) || !size.w || !size.h) return null;
        const B = (bearing(start, end) * Math.PI) / 180;
        const kLat = 110540;
        const kLng = 111320 * Math.cos((start.latitude * Math.PI) / 180);
        let minA = Infinity; let maxA = -Infinity; let minC = Infinity; let maxC = -Infinity;
        for (const q of [...line, end]) {
            const e = (q.longitude - start.longitude) * kLng;
            const n = (q.latitude - start.latitude) * kLat;
            const along = e * Math.sin(B) + n * Math.cos(B);
            const across = e * Math.cos(B) - n * Math.sin(B);
            if (along < minA) minA = along;
            if (along > maxA) maxA = along;
            if (across < minC) minC = across;
            if (across > maxC) maxC = across;
        }
        const midA = (minA + maxA) / 2;
        const midC = (minC + maxC) / 2;
        const e = midA * Math.sin(B) + midC * Math.cos(B);
        const n = midA * Math.cos(B) - midC * Math.sin(B);
        const center = { latitude: start.latitude + n / kLat, longitude: start.longitude + e / kLng };
        const spanA = Math.max(60, maxA - minA);
        const spanC = Math.max(60, maxC - minC);
        const zoomFor = (metres2, px) => Math.log2((156543.03 * Math.cos((center.latitude * Math.PI) / 180) * Math.max(60, px)) / metres2);
        const zoom = Math.max(7, Math.min(18, Math.min(zoomFor(spanA, size.w - 300), zoomFor(spanC, size.h - 220)) - 0.3));
        return { center, heading: norm((B * 180) / Math.PI - 90), zoom };
    }, [line, start?.latitude, start?.longitude, end?.latitude, end?.longitude, size.w, size.h]);   // eslint-disable-line react-hooks/exhaustive-deps

    const place = () => { if (ready.current && aim && !userMoved.current) { programmatic.current = Date.now(); map.current?.animateCamera({ ...aim, pitch: 0 }, { duration: 500 }); } };
    // the camera moves again only when the way has really changed (not on every tiny GPS step)
    const aimKey = aim ? `${Math.round(aim.heading / 4)}|${Math.round(aim.zoom * 8)}|${Math.round(aim.center.latitude * 2000)}|${Math.round(aim.center.longitude * 2000)}` : '';
    useEffect(place, [aimKey]);   // eslint-disable-line react-hooks/exhaustive-deps

    // compass button (like Google Maps): north to the top and the tilt off
    const northUp = () => { touched(); map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 }); };
    // reset button: the starting view again
    const resetView = () => { userMoved.current = false; setMoved(false); place(); };

    const first = start || destination;
    return (
        <View
            style={{ flex: 1 }}
            onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            onTouchStart={() => onGesture?.(true)}
            onTouchEnd={(e) => { if (!e.nativeEvent.touches?.length) onGesture?.(false); }}
            onTouchCancel={() => onGesture?.(false)}
        >
            <MapView
                ref={map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                style={StyleSheet.absoluteFill}
                initialRegion={{ ...first, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
                scrollEnabled zoomEnabled rotateEnabled pitchEnabled
                showsCompass={false} toolbarEnabled={false}
                onPanDrag={touched}
                onRegionChangeComplete={(_, g) => { readCamera(); if (g?.isGesture && Date.now() - programmatic.current > 900) touched(); }}
                onMapReady={() => { ready.current = true; place(); readCamera(); }}
            >
                {line.length > 1 ? <Polyline coordinates={line} strokeColor={primary} strokeWidth={full ? 4 : 3} lineDashPattern={estimate ? [10, 10] : undefined} /> : null}
                {/* the start: the shop's name before pickup, "Your location" on his way */}
                {ok(start) && startLabel ? (
                    <Marker coordinate={start} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={track}>
                        <View style={{ alignItems: 'center' }}>
                            <View style={[s.tag, { backgroundColor: surface, borderColor: live ? primary : '#F59E0B' }]}>
                                <Ionicons name={live ? 'locate' : 'storefront'} size={13} color={live ? primary : '#F59E0B'} />
                                <Text numberOfLines={1} style={[s.tagText, { color: text }]}>{startLabel}</Text>
                            </View>
                            <View style={[s.dot, { backgroundColor: live ? primary : '#F59E0B' }]} />
                        </View>
                    </Marker>
                ) : null}
                {/* the end: the customer's name, and the time under it */}
                {ok(destination) ? (
                    <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={track}>
                        <View style={{ alignItems: 'center' }}>
                            <View style={[s.tag, { backgroundColor: surface, borderColor: '#E53935' }]}>
                                <Ionicons name="home" size={13} color="#E53935" />
                                <View style={{ marginLeft: 4 }}>
                                    {endLabel ? <Text numberOfLines={1} style={[s.tagText, { color: text, marginLeft: 0 }]}>{endLabel}</Text> : null}
                                    {label ? <Text numberOfLines={1} style={{ color: muted, fontWeight: '800', fontSize: 10 }}>{label}</Text> : null}
                                </View>
                            </View>
                            <View style={s.pin}><Ionicons name="home" size={15} color="#FFFFFF" /></View>
                        </View>
                    </Marker>
                ) : null}
            </MapView>

            {metres != null ? (
                <View style={[s.chip, { backgroundColor: surface, borderColor: border, top: 10 + topInset }]}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {nice(metres)}{live ? ` ${tr('left')}` : ''}{live && etaMin ? ` · ~${etaMin} min` : ''}
                    </Text>
                    {!live ? <Text style={{ color: muted, fontWeight: '700', fontSize: 11 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{tr('total distance')}</Text> : null}
                </View>
            ) : null}

            {/* the compass: the needle shows real north from the phone's sensor; a tap turns the map north-up */}
            <Pressable onPress={northUp} style={[s.compass, { backgroundColor: surface, borderColor: border, top: 10 + topInset }]} accessibilityLabel={tr('North up')}>
                <Needle mapHeading={cam.heading} />
            </Pressable>
            {/* bottom left: back to the starting view */}
            {moved ? (
                <Pressable onPress={resetView} style={[s.round, { left: 10, backgroundColor: surface, borderColor: border }]} accessibilityLabel={tr('Show the whole way')}>
                    <Ionicons name="scan-outline" size={20} color={primary} />
                </Pressable>
            ) : null}
            {/* bottom right: the map full screen / back */}
            <Pressable onPress={onToggle} style={[s.round, { right: 10, backgroundColor: surface, borderColor: border }]} accessibilityLabel={full ? tr('Minimize the map') : tr('Maximize the map')}>
                <Ionicons name={full ? 'contract' : 'expand'} size={20} color={primary} />
            </Pressable>
        </View>
    );
}

/* ------------------------------ the rider map ------------------------------ */
// label: the text under the customer's name (the time). etaMin: the tentative minutes to reach (from the server, on his way).
// startLabel: the name at the start (the shop before pickup, "Your location" on his way). endLabel: the customer's name.
export default function RiderMap({ destination, route, live = false, label, startLabel, endLabel, etaMin, height = 260, style, onGesture }) {
    const { border, surface, muted } = useBrand();
    const insets = useSafeAreaInsets();
    const [me, setMe] = useState(null);
    const [full, setFull] = useState(false);
    const done = useRef({ route: null, idx: 0 });   // how far along the road he has got: the line only ever gets shorter

    // his position, only while he is on his way, only to cut the line
    useEffect(() => {
        if (!live) { setMe(null); return undefined; }
        let sub = null;
        let dead = false;
        (async () => {
            try {
                let p = await Location.getForegroundPermissionsAsync();
                if (!p.granted && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
                if (!p.granted || dead) return;
                const last = await Location.getLastKnownPositionAsync().catch(() => null);
                if (last?.coords && !dead) setMe({ latitude: last.coords.latitude, longitude: last.coords.longitude });
                sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 10 }, (x) => {
                    if (!dead && x?.coords) setMe({ latitude: x.coords.latitude, longitude: x.coords.longitude });
                });
                if (dead) sub.remove();
            } catch (e) { /* no position: the whole road is drawn */ }
        })();
        return () => { dead = true; sub?.remove?.(); };
    }, [live]);

    const roadLine = useMemo(() => (route?.polyline ? decodePolyline(route.polyline) : []), [route?.polyline]);
    // the road still ahead: from the closest point on the road to him, to the customer. Never grows back, even if the GPS drifts.
    const line = useMemo(() => {
        if (roadLine.length < 2) return roadLine;
        if (done.current.route !== roadLine) done.current = { route: roadLine, idx: 0 };
        if (!live || !ok(me)) return roadLine.slice(done.current.idx);
        let i = nearest(roadLine, me, Math.max(0, done.current.idx - 2), Math.min(roadLine.length - 1, done.current.idx + 150));
        if (km(me, roadLine[i]) * 1000 > 250) i = nearest(roadLine, me);
        if (km(me, roadLine[i]) * 1000 > 120) return roadLine.slice(done.current.idx);   // far from the road: keep what was left
        const piece = [[i - 1, i], [i, i + 1]].reduce((best, [a, b]) => {
            if (a < 0 || b >= roadLine.length) return best;
            const q = onPiece(roadLine[a], roadLine[b], me);
            return !best || km(me, q) < km(me, best.q) ? { q, b } : best;
        }, null);
        const ahead = piece ? piece.b : Math.min(i + 1, roadLine.length - 1);
        done.current.idx = Math.max(done.current.idx, ahead);
        return [piece ? piece.q : roadLine[i], ...roadLine.slice(done.current.idx)];
    }, [roadLine, me, live]);   // eslint-disable-line react-hooks/exhaustive-deps

    const metres = line.length > 1 ? (live ? lengthM(line) : (route?.distanceM || lengthM(line))) : null;
    const start = line[0];
    const end = ok(destination) ? destination : line[line.length - 1];

    if (!ok(destination) && line.length < 2) {
        return (
            <View style={[s.box, { height: 90, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }, style]}>
                <Text style={{ color: muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16 }}>{tr('The customer has no pin on the map.')}</Text>
            </View>
        );
    }
    const pane = (isFull) => (
        <MapPane
            line={line} start={start} end={end} destination={destination} estimate={!!route && route.source !== 'google'} live={live}
            label={label} startLabel={startLabel} endLabel={endLabel} metres={metres} etaMin={etaMin}
            full={isFull} onToggle={() => setFull(!isFull)} topInset={isFull ? insets.top : 0} onGesture={isFull ? undefined : onGesture}
        />
    );
    return (
        <>
            {/* one map at a time: the box is empty while the full-screen map is open */}
            <View style={[s.box, { height, borderColor: border }, style]}>{full ? null : pane(false)}</View>
            <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)} statusBarTranslucent>
                <View style={{ flex: 1, backgroundColor: surface }}>{full ? pane(true) : null}</View>
            </Modal>
        </>
    );
}

const s = StyleSheet.create({
    box: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
    pin: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    tag: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, paddingVertical: 3, paddingHorizontal: 8, marginBottom: 3, elevation: 4, maxWidth: 150 },
    tagText: { fontWeight: '900', fontSize: 12, marginLeft: 4 },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    chip: { position: 'absolute', left: 10, borderRadius: 12, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 12, elevation: 3, maxWidth: '60%' },
    compass: { position: 'absolute', right: 10, width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    needle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
    north: { position: 'absolute', top: 2, fontSize: 9, fontWeight: '900', color: '#E53935' },
    needleN: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 14, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#E53935', marginTop: 8 },
    needleS: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 14, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#9CA3AF' },
    round: { position: 'absolute', bottom: 10, width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
