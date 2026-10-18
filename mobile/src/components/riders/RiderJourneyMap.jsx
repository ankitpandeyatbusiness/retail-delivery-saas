// The rider's own map, full screen behind the delivery sheet. First person: everything on it comes from HIS phone's GPS.
//
//   BEFORE PICKUP (he is at the shop, no trip to the shop): a preview. The 3D scooter where he is and the customer's home pin, joined by a
//   straight DASHED line, framed together above the sheet. No Google call.
//
//   AFTER PICKUP ("On the way"): NAVIGATION MODE, like Google Maps.
//     - the route line is the live Google route from him to the home pin (the server keeps it fresh from his pings: no extra call); the
//       road behind him is cut away as he drives
//     - the icon is a navigation chevron, a FLAT map marker (lying on the road, with a soft 30 m halo) at the centre of the locked camera
//     - the camera is locked on him: on every move the map's centre is set to his position (zoom 19, pitch 60)
//     - the map's heading is his real-time bearing, so "forward" is always the top of the screen. The bearing is his GPS course while he
//       moves (rounding a corner turns the map) and the phone's compass when he is slow or still (turning the phone turns the map)
//     - touching / dragging the map pauses the lock at once, so he can look ahead; the chevron then becomes a normal marker on the road.
//       The recenter button snaps the camera back (zoom 19, pitch 60, his position, his bearing) and resumes the lock
//   Buildings are switched off: only the flat map, the route and the chevron.
//
// Only ONE destination is ever shown: the customer's home pin. route = { source, polyline } the live route (or null).
// remainingM / etaMin: the server's figures after pickup.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import RiderTrack from '../common/RiderTrack';
import HomePin from '../common/HomePin';
import { useMapStyle } from '../../utils/common/mapStyle';
import { decodePolyline } from '../../utils/common/polyline';
import { tr } from '../../i18n';

const DRIVE_ZOOM = 19;     // very close: he can see his next turn
const DRIVE_PITCH = 60;    // the angled navigation view

const rad = (x) => (x * Math.PI) / 180;
const ok = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
const km = (a, b) => {
    const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
};
const metres = (a, b) => km(a, b) * 1000;
const bearing = (a, b) => {
    const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
    const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
    return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};
const turn = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;           // the signed shortest way from a to b
const easeAngle = (a, b, k) => (a + k * turn(a, b) + 360) % 360;
const nearestIdx = (line, p) => {
    const k = Math.cos(rad(p.latitude));
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < line.length; i += 1) {
        const dy = line[i].latitude - p.latitude;
        const dx = (line[i].longitude - p.longitude) * k;
        const d = dy * dy + dx * dx;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
};
const nice = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

export default function RiderJourneyMap({ destination, route, onTheWay, customerName, bottomPad = 0, remainingM, etaMin }) {
    const { primary, border, surface, text, muted } = useBrand();
    const mapStyle = useMapStyle();
    const map = useRef(null);
    const ready = useRef(false);
    const manual = useRef(false);          // he touched the map: the camera lock is paused until he taps recenter
    const lastFit = useRef(0);
    const programmatic = useRef(0);        // when our own camera move ends, that is not a hand gesture
    const headingRef = useRef(null);       // the way he faces (degrees), eased
    const prevRef = useRef(null);          // his last position that was at least a few metres from the one before
    const compassRef = useRef(null);       // the phone's compass (degrees), smoothed
    const driveRef = useRef(null);         // the latest drive(), for callbacks
    const [me, setMe] = useState(null);    // { lat, lng, course } from the phone's GPS
    const [moved, setMoved] = useState(false);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [navHeading, setNavHeading] = useState(0);   // the camera's bearing: the chevron marker uses this very value, so it always points to the top
    const [padOn, setPadOn] = useState(false);   // map padding may only be set once Google's map exists (before that it crashes on Android)
    const [settle, setSettle] = useState(true);   // the pin is a custom view: drawn again for a moment when it appears

    // his own GPS, straight from the phone (about once a second)
    useEffect(() => {
        let sub = null;
        let dead = false;
        (async () => {
            try {
                let p = await Location.getForegroundPermissionsAsync();
                if (!p.granted && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
                if (!p.granted || dead) return;
                const last = await Location.getLastKnownPositionAsync().catch(() => null);
                if (last?.coords && !dead) setMe({ lat: last.coords.latitude, lng: last.coords.longitude, course: null });
                sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }, (x) => {
                    if (dead || !x?.coords) return;
                    const c = x.coords;
                    const moving = Number.isFinite(c.heading) && c.heading >= 0 && (c.speed || 0) > 1.5;   // a GPS course is only true while he moves
                    setMe({ lat: c.latitude, lng: c.longitude, course: moving ? c.heading : null, at: Date.now() });
                });
                if (dead) sub.remove();
            } catch (e) { /* no position: only the customer's pin is shown */ }
        })();
        return () => { dead = true; sub?.remove?.(); };
    }, []);

    const dest = ok(destination) ? destination : null;
    useEffect(() => { setSettle(true); const t = setTimeout(() => setSettle(false), 1500); return () => clearTimeout(t); }, [!!dest, primary]);   // eslint-disable-line react-hooks/exhaustive-deps

    // the road: only after pickup, and only a real Google one; otherwise the dashed straight line is drawn (RiderTrack)
    const live = onTheWay && route?.source === 'google' && !!route.polyline;
    const road = useMemo(() => (live ? decodePolyline(route.polyline) : []), [live, route?.polyline]);   // eslint-disable-line react-hooks/exhaustive-deps

    /* ------------------------------ before pickup: frame the scooter and the pin above the sheet ------------------------------ */
    const fit = (force) => {
        if (onTheWay || !ready.current || !map.current || (manual.current && !force)) return;
        const rider = me ? { latitude: me.lat, longitude: me.lng } : null;
        const pts = [rider, dest].filter(ok);
        if (!pts.length) return;
        lastFit.current = Date.now();
        if (pts.length === 1) {
            // one point: put it in the middle of the part of the map that is NOT under the sheet (shift the map's centre down by half the sheet)
            const delta = 0.01;
            const shift = size.h ? (delta * bottomPad) / (2 * size.h) : 0;
            map.current.animateToRegion({ latitude: pts[0].latitude - shift, longitude: pts[0].longitude, latitudeDelta: delta, longitudeDelta: delta }, 400);
        } else {
            map.current.fitToCoordinates(pts, { edgePadding: { top: 110, right: 70, bottom: bottomPad + 50, left: 70 }, animated: true });
        }
    };

    /* ------------------------------ navigation: the bearing, and the camera lock ------------------------------ */
    // his real-time bearing: the GPS course while he moves, the phone's compass when he is slow or still, else the road ahead, else the
    // way he just moved, else the way to the home pin
    // a GPS course is only believed while its fix is fresh: when he stops, no new fix may come, and the old course must not hide the compass
    const courseNow = () => (me?.course != null && me.at && Date.now() - me.at < 3000 ? me.course : null);
    const courseNowRef = useRef(courseNow);
    courseNowRef.current = courseNow;
    const updateHeading = () => {
        if (!me) return;
        const here = { latitude: me.lat, longitude: me.lng };
        let target = null;
        let k = 0.5;
        if (courseNow() != null) target = courseNow();
        else if (compassRef.current != null) { target = compassRef.current; k = 0.35; }
        else if (road.length > 1) {
            const i = nearestIdx(road, here);
            if (metres(here, road[i]) < 60) {
                let j = Math.min(i + 1, road.length - 1);
                while (j < road.length - 1 && metres(here, road[j]) < 25) j += 1;
                if (metres(here, road[j]) > 1) target = bearing(here, road[j]);
            }
        }
        if (target == null && prevRef.current && metres(prevRef.current, here) > 3) target = bearing(prevRef.current, here);
        if (target == null && headingRef.current == null && dest) target = bearing(here, dest);
        if (target != null) headingRef.current = headingRef.current == null ? target : easeAngle(headingRef.current, target, k);
        if (!prevRef.current || metres(prevRef.current, here) > 3) prevRef.current = here;
        const h = Math.round(headingRef.current ?? 0);
        setNavHeading((old) => (Math.abs(turn(old, h)) >= 1 ? h : old));
    };

    // The camera lock: the map's centre is set to the rider and the map is turned to his bearing, so the chevron (a fixed picture at the
    // centre of the screen) never moves and the MAP moves under it. force = the recenter button: snap to his GPS position at once.
    // ms = how long the map glides to the new centre / bearing: a GPS fix comes about once a second, so 1000 ms fills the gap exactly and the
    // map never snaps; a compass turn while he stands still uses a short glide so the map follows his wrist at once.
    const drive = (force, ms = 1000) => {
        if (!onTheWay || !ready.current || !map.current || !me || (manual.current && !force)) return;
        const p = { latitude: me.lat, longitude: me.lng };
        programmatic.current = Date.now();
        const cam = { center: p, zoom: DRIVE_ZOOM, heading: headingRef.current ?? 0, pitch: DRIVE_PITCH };
        map.current.animateCamera(cam, { duration: force ? 400 : ms });
        // the recenter button: send the 3D driver view once more when the first move has ended, so nothing can leave it flat
        if (force) setTimeout(() => { if (!manual.current && map.current) { programmatic.current = Date.now(); map.current.animateCamera({ ...cam, heading: headingRef.current ?? cam.heading }, { duration: 200 }); } }, 600);
    };
    driveRef.current = drive;

    // the phone's compass (only in navigation mode): turning the phone turns the map
    useEffect(() => {
        if (!onTheWay) { compassRef.current = null; return undefined; }
        let sub = null;
        let dead = false;
        let lastAt = 0;
        (async () => {
            try {
                const p = await Location.getForegroundPermissionsAsync();
                if (!p.granted || dead) return;
                sub = await Location.watchHeadingAsync((h) => {
                    const raw = h?.trueHeading >= 0 ? h.trueHeading : h?.magHeading;
                    const now = Date.now();
                    if (dead || !Number.isFinite(raw) || now - lastAt < 50) return;
                    lastAt = now;
                    compassRef.current = compassRef.current == null ? raw : easeAngle(compassRef.current, raw, 0.7);   // only a light filter: a quick turn of the wrist must be followed
                    // standing still (no fresh GPS course): the compass drives the map and the arrow at once, straight from the sensor
                    if (!manual.current && courseNowRef.current() == null) {
                        headingRef.current = compassRef.current;
                        const r = Math.round(compassRef.current);
                        setNavHeading((old) => (Math.abs(turn(old, r)) >= 1 ? r : old));
                        driveRef.current?.(false, 100);
                    }
                });
                if (dead) sub.remove();
            } catch (e) { /* no compass: the GPS course and the road are used */ }
        })();
        return () => { dead = true; sub?.remove?.(); };
    }, [onTheWay]);

    // every new GPS fix: work out the bearing; before pickup keep the preview framed
    useEffect(() => {
        updateHeading();
        if (onTheWay) driveRef.current?.(false, 1000);
        else if (Date.now() - lastFit.current > 3000) fit(false);
    }, [me?.lat, me?.lng, me?.course, dest?.latitude, dest?.longitude]);   // eslint-disable-line react-hooks/exhaustive-deps

    // the compass turns the map even when no new fix comes (he stands still and turns his wrist): a short, regular check. While he moves the
    // GPS course sets the bearing at every fix, so this only runs when there is no course.
    useEffect(() => {
        if (!onTheWay) return undefined;
        const id = setInterval(() => {
            if (manual.current || courseNow() != null) return;
            const before = headingRef.current;
            updateHeading();
            if (before == null || Math.abs(turn(before, headingRef.current ?? before)) > 1) driveRef.current?.(false, 200);
        }, 120);
        return () => clearInterval(id);
    }, [onTheWay, me?.lat, me?.lng, me?.course]);   // eslint-disable-line react-hooks/exhaustive-deps

    // the sheet changed size, or the road arrived
    useEffect(() => { if (onTheWay) drive(false); else fit(false); }, [bottomPad, road]);   // eslint-disable-line react-hooks/exhaustive-deps
    // pickup (or back): the camera switches mode at once
    useEffect(() => {
        manual.current = false;
        setMoved(false);
        updateHeading();
        if (onTheWay) drive(true); else fit(true);
    }, [onTheWay]);   // eslint-disable-line react-hooks/exhaustive-deps

    const rider = me ? { latitude: me.lat, longitude: me.lng } : null;
    const straight = rider && dest ? metres(rider, dest) : null;
    const first = dest || rider || { latitude: 22.5, longitude: 79 };
    // navigation mode: the chevron is a FLAT map marker (it lies on the road and tilts with the map) at the centre of the locked camera
    const marker = onTheWay ? 'chevron' : 'scooter';
    return (
        <View style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            <MapView
                ref={map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                customMapStyle={mapStyle}
                style={StyleSheet.absoluteFill}
                initialRegion={{ ...first, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                scrollEnabled zoomEnabled rotateEnabled={false} pitchEnabled={false}
                showsBuildings={false}
                mapPadding={padOn && onTheWay ? { top: Math.round(size.h * 0.3), right: 0, bottom: bottomPad, left: 0 } : { top: 0, right: 0, bottom: 0, left: 0 }}
                showsCompass={false} toolbarEnabled={false}
                onPanDrag={() => { manual.current = true; setMoved(true); }}
                onRegionChangeComplete={(_, g) => { if (g?.isGesture && Date.now() - programmatic.current > 1200) { manual.current = true; setMoved(true); } }}
                onMapReady={() => { ready.current = true; setPadOn(true); if (onTheWay) drive(true); else fit(true); }}
            >
                {/* the one destination: the customer's home */}
                {dest ? (
                    <Marker coordinate={dest} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle} zIndex={4}>
                        <HomePin size={32} label={customerName ? String(customerName).slice(0, 12) : undefined} />
                    </Marker>
                ) : null}
                {/* the line to the home pin (dashed and straight until a real road exists), and his marker unless the fixed chevron is on */}
                {me ? (
                    <RiderTrack
                        road={road} loc={me} dest={dest} orderId="journey" color={primary} estimate={false} lineWidth={onTheWay ? 7 : 5} casing={4} solid={onTheWay} lineColor={onTheWay ? '#1D4ED8' : undefined} halo={onTheWay ? 15 : 0} title={tr('You')}
                        marker={marker} headingOverride={onTheWay ? navHeading : undefined}
                    />
                ) : null}
            </MapView>

            {straight != null ? (
                <View style={[s.chip, { backgroundColor: surface, borderColor: border }]}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {onTheWay
                            ? `${nice(remainingM != null ? remainingM : straight)} ${tr('left')}${etaMin ? ` · ~${etaMin} min` : ''}`
                            : `${nice(straight)} ${tr('straight to the customer')}`}
                    </Text>
                    {!onTheWay ? <Text style={{ color: muted, fontWeight: '700', fontSize: 11 }}>{tr('A preview: the road shows after pickup')}</Text> : null}
                </View>
            ) : null}

            {moved ? (
                <Pressable
                    onPress={() => { manual.current = false; setMoved(false); updateHeading(); if (onTheWay) drive(true); else fit(true); }}
                    style={[s.recenter, { backgroundColor: surface, borderColor: border, bottom: bottomPad + 12 }]}
                    accessibilityLabel={tr('Show me and the customer')}
                >
                    <Ionicons name="locate" size={22} color={primary} />
                </Pressable>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    chip: { position: 'absolute', left: 10, top: 10, borderRadius: 12, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12, elevation: 4, maxWidth: '78%' },
    recenter: { position: 'absolute', right: 12, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 5 },
});
