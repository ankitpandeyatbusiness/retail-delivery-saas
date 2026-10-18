// The rider's own map, full screen behind the delivery sheet. First person: the scooter is where HIS phone says he is, fed straight from
// the phone's GPS (not through the server), turning to his direction of travel.
//   before pickup (he is at the shop)   his position and the customer's home pin, joined by a straight DASHED line ("as the crow flies").
//                                       A free preview of where he is going: no Google call.
//   after pickup (out for delivery)     the live Google route from his position to the home pin (the server keeps it fresh from his
//                                       pings and pushes it: no extra call). The road behind him is cut away as he drives.
// Only ONE destination is ever shown: the customer's home pin (the rider is stationed at the shop, so there is no trip to the shop).
// The map keeps the scooter and the pin in view above the bottom sheet (bottomPad), until he moves the map himself; then a recenter
// button appears. He can pan and zoom freely.
// route = { source, polyline } the live route (or null). remainingM / etaMin: the server's figures after pickup.
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

const ok = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
const km = (a, b) => {
    const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
};
const nice = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

export default function RiderJourneyMap({ destination, route, onTheWay, customerName, bottomPad = 0, remainingM, etaMin }) {
    const { primary, border, surface, text, muted } = useBrand();
    const mapStyle = useMapStyle();
    const map = useRef(null);
    const ready = useRef(false);
    const manual = useRef(false);        // he moved or zoomed the map himself: it is not pulled back until he taps recenter
    const lastFit = useRef(0);
    const [me, setMe] = useState(null);
    const [moved, setMoved] = useState(false);
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
                if (last?.coords && !dead) setMe({ lat: last.coords.latitude, lng: last.coords.longitude });
                sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }, (x) => {
                    if (!dead && x?.coords) setMe({ lat: x.coords.latitude, lng: x.coords.longitude });
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

    // keep the scooter and the pin in view (above the sheet) until he moves the map
    const fit = (force) => {
        if (!ready.current || !map.current || (manual.current && !force)) return;
        const rider = me ? { latitude: me.lat, longitude: me.lng } : null;
        const pts = [rider, dest].filter(ok);
        if (!pts.length) return;
        lastFit.current = Date.now();
        if (pts.length === 1) map.current.animateToRegion({ ...pts[0], latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
        else map.current.fitToCoordinates(pts, { edgePadding: { top: 110, right: 70, bottom: 50, left: 70 }, animated: true });
    };
    useEffect(() => { if (Date.now() - lastFit.current > 3000) fit(false); }, [me?.lat, me?.lng, dest?.latitude, dest?.longitude]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { fit(false); }, [bottomPad]);   // eslint-disable-line react-hooks/exhaustive-deps

    const rider = me ? { latitude: me.lat, longitude: me.lng } : null;
    const straight = rider && dest ? km(rider, dest) * 1000 : null;
    const first = dest || rider || { latitude: 22.5, longitude: 79 };
    return (
        <View style={StyleSheet.absoluteFill}>
            <MapView
                ref={map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                customMapStyle={mapStyle}
                style={StyleSheet.absoluteFill}
                mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomPad }}
                initialRegion={{ ...first, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                scrollEnabled zoomEnabled rotateEnabled={false} pitchEnabled={false}
                showsCompass={false} toolbarEnabled={false}
                onPanDrag={() => { manual.current = true; setMoved(true); }}
                onRegionChangeComplete={(_, g) => { if (g?.isGesture) { manual.current = true; setMoved(true); } }}
                onMapReady={() => { ready.current = true; fit(true); }}
            >
                {/* the one destination: the customer's home */}
                {dest ? (
                    <Marker coordinate={dest} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle} zIndex={4}>
                        <HomePin size={32} label={customerName ? String(customerName).slice(0, 12) : undefined} />
                    </Marker>
                ) : null}
                {/* his scooter and the line to the home pin (dashed and straight until a real road exists) */}
                {me ? <RiderTrack road={road} loc={me} dest={dest} orderId="journey" color={primary} estimate={false} lineWidth={5} casing={4} title={tr('You')} /> : null}
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
                    onPress={() => { manual.current = false; setMoved(false); fit(true); }}
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
