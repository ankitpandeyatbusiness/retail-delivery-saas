// The Blinkit-style live delivery for the customer: a small bar above the tabs while an order is on its way, which opens into
// a map sheet that can be dragged: full screen, half screen, or shrunk back to the bar.
//
//   bar   : "Arriving in 8 min", the rider's name and how far away he is. Tap it to open the map.
//   half  : the map on top, the arrival time, the rider and the delivery PIN below.
//   full  : the same, with the map filling the screen.
// Drag the handle (the top of the sheet) up or down to change size; the Back button shrinks it to the bar.
//
// Mounted once in the navigator. The data comes from useLiveTrip (socket first, polling when the server asks for it).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, PanResponder, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { tint } from './shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useLiveTripStore } from '../../store/customers/useLiveTripStore';
import { useLiveTrip } from '../../hooks/customers/useLiveTrip';
import { decodePolyline } from '../../utils/common/polyline';

// screens where the bar would sit on top of something the customer is using
const HIDE_ON = ['Login', 'Cart', 'Item', 'OrderPlaced', 'OrderDetail', 'CardDetails', 'PaymentMethods'];
const TAB_H = 62;

function useNow(everyMs) {
    const [, setN] = useState(0);
    useEffect(() => { const t = setInterval(() => setN((n) => n + 1), everyMs); return () => clearInterval(t); }, [everyMs]);
    return Date.now();
}

const dist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

// the words for the arrival time
function eta(e, now) {
    if (!e) return { head: 'On the way', mins: null };
    if (e.remainingM != null && e.remainingM <= 80) return { head: 'Your delivery partner has arrived', mins: 0 };
    const mins = Math.max(1, Math.ceil((new Date(e.etaAt).getTime() - now) / 60000));
    if (!Number.isFinite(mins)) return { head: 'On the way', mins: null };
    return { head: mins <= 1 ? 'Arriving now' : `Arriving in ${mins} min`, mins };
}

export default function LiveOrderHost({ routeName }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && user.role !== 'rider' && user.role !== 'admin';
    useLiveTrip(enabled);

    const { orderId, orderNo, track, loc, route, eta: e, dest, quiet, sheet } = useLiveTripStore();
    const setSheet = useLiveTripStore((s) => s.setSheet);
    const { primary, text, muted, surface, border, background } = useBrand();
    const insets = useSafeAreaInsets();
    const { height: H } = useWindowDimensions();
    const now = useNow(20000);

    const SHEET_H = Math.round(H * 0.93);
    const VISIBLE = useMemo(() => ({ bar: 0, half: Math.round(H * 0.58), full: SHEET_H }), [H, SHEET_H]);
    const y = useRef(new Animated.Value(SHEET_H)).current;
    const base = useRef(SHEET_H);
    const sheetRef = useRef(sheet);
    sheetRef.current = sheet;

    const snapTo = useCallback((name) => {
        const to = SHEET_H - VISIBLE[name];
        base.current = to;
        Animated.spring(y, { toValue: to, useNativeDriver: true, bounciness: 3, speed: 16 }).start();
    }, [y, SHEET_H, VISIBLE]);
    useEffect(() => { snapTo(orderId ? sheet : 'bar'); }, [sheet, orderId, snapTo]);

    // dragging the handle
    const pan = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => { y.stopAnimation((v) => { base.current = v; }); },
        onPanResponderMove: (_, g) => {
            y.setValue(Math.min(SHEET_H, Math.max(SHEET_H - VISIBLE.full, base.current + g.dy)));
        },
        onPanResponderRelease: (_, g) => {
            const visible = SHEET_H - Math.min(SHEET_H, Math.max(SHEET_H - VISIBLE.full, base.current + g.dy));
            // a quick flick goes one step; a slow drag goes to the nearest size
            const order = ['bar', 'half', 'full'];
            let i = order.indexOf(sheetRef.current);
            if (Math.abs(g.vy) > 0.6) i = Math.max(0, Math.min(2, i + (g.vy < 0 ? 1 : -1)));
            else i = order.map((n) => Math.abs(VISIBLE[n] - visible)).reduce((b, d, k, a) => (d < a[b] ? k : b), 0);
            if (order[i] === sheetRef.current) snapTo(order[i]); else setSheet(order[i]);
        },
    }), [y, SHEET_H, VISIBLE, snapTo, setSheet]);

    // Back shrinks the sheet to the bar
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (orderId && sheetRef.current !== 'bar') { setSheet('bar'); return true; }
            return false;
        });
        return () => sub.remove();
    }, [orderId, setSheet]);

    /* ------------------------------ the map ------------------------------ */
    const map = useRef(null);
    const bike = useRef(null);
    const first = useRef(null);
    const manual = useRef(false);        // the customer moved the map himself: stop pulling it back
    const lastFit = useRef(0);
    useEffect(() => { first.current = null; manual.current = false; lastFit.current = 0; }, [orderId]);
    const rider = loc ? { latitude: loc.lat, longitude: loc.lng } : null;
    if (rider && !first.current) first.current = rider;
    useEffect(() => {
        if (rider && bike.current?.animateMarkerToCoordinate) bike.current.animateMarkerToCoordinate(rider, 1200);
    }, [loc?.lat, loc?.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    const line = useMemo(() => {
        if (route?.source === 'google') { const pts = decodePolyline(route.polyline); if (pts.length > 1) return pts; }
        return rider && dest ? [rider, dest] : [];
    }, [route, loc?.lat, loc?.lng, dest]);   // eslint-disable-line react-hooks/exhaustive-deps

    const fit = useCallback((force) => {
        if (!map.current || !rider || sheetRef.current === 'bar') return;
        if (manual.current && !force) return;
        const pts = dest ? [rider, dest] : [rider];
        map.current.fitToCoordinates(pts, { edgePadding: { top: 90, right: 60, bottom: 60, left: 60 }, animated: true });
        lastFit.current = Date.now();
    }, [rider?.latitude, rider?.longitude, dest?.latitude]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (Date.now() - lastFit.current > 8000) fit(false); }, [loc?.lat, loc?.lng, sheet]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled || !orderId || !track) return null;

    const t = eta(e, now);
    const name = track.rider?.name;
    const far = dist(e?.remainingM);
    const estimate = e?.source && e.source !== 'google' && e.source !== 'route';
    const sub = [name, far && `${estimate ? 'about ' : ''}${far} away`].filter(Boolean).join(' · ') || `Order #${orderNo}`;
    const showBar = !HIDE_ON.includes(routeName) && sheet === 'bar';

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {showBar ? (
                <Pressable
                    onPress={() => setSheet('half')}
                    style={[s.bar, { bottom: insets.bottom + TAB_H + 10, backgroundColor: surface, borderColor: border }]}
                    accessibilityRole="button" accessibilityLabel="Open live delivery map"
                >
                    <View style={[s.barIc, { backgroundColor: primary }]}>
                        <Ionicons name="bicycle" size={22} color="#FFFFFF" />
                    </View>
                    <View style={s.barText}>
                        <Text style={[s.barHead, { color: text }]} numberOfLines={1}>{quiet ? 'Reconnecting to your delivery partner' : t.head}</Text>
                        <Text style={[s.barSub, { color: muted }]} numberOfLines={1}>{sub}</Text>
                    </View>
                    <Text style={[s.barGo, { color: primary }]}>Track</Text>
                    <Ionicons name="chevron-up" size={20} color={primary} />
                </Pressable>
            ) : null}

            <Animated.View
                pointerEvents={sheet === 'bar' ? 'none' : 'auto'}
                style={[s.sheet, { height: SHEET_H, backgroundColor: background, borderColor: border, transform: [{ translateY: y }] }]}
            >
                <View {...pan.panHandlers} style={s.grab}>
                    <View style={[s.handle, { backgroundColor: border }]} />
                    <Text style={[s.sheetHead, { color: text }]} numberOfLines={1}>{quiet ? 'Reconnecting to your delivery partner' : t.head}</Text>
                    <Text style={[s.sheetSub, { color: muted }]} numberOfLines={1}>{sub}</Text>
                </View>

                <View style={s.mapBox}>
                    {sheet !== 'bar' && (rider || dest) ? (
                        <MapView
                            ref={map}
                            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                            style={StyleSheet.absoluteFill}
                            initialRegion={{ ...(dest || rider), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                            showsCompass={false} toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                            onPanDrag={() => { manual.current = true; }}
                            onMapReady={() => fit(true)}
                        >
                            {line.length > 1 ? <Polyline coordinates={line} strokeColor={primary} strokeWidth={5} lineDashPattern={route?.source === 'google' ? undefined : [10, 10]} /> : null}
                            {rider ? (
                                <Marker ref={bike} coordinate={first.current || rider} anchor={{ x: 0.5, y: 0.5 }} flat rotation={loc?.heading || 0} tracksViewChanges={false}>
                                    <View style={[s.bike, { backgroundColor: primary }]}><Ionicons name="bicycle" size={20} color="#FFFFFF" /></View>
                                </Marker>
                            ) : null}
                            {dest ? (
                                <Marker coordinate={dest} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                                    <View style={s.home}><Ionicons name="home" size={16} color="#FFFFFF" /></View>
                                </Marker>
                            ) : null}
                        </MapView>
                    ) : null}
                    {!rider ? (
                        <View style={[s.wait, { backgroundColor: surface, borderColor: border }]}>
                            <Text style={[s.barSub, { color: muted }]}>Waiting for the delivery partner's location…</Text>
                        </View>
                    ) : (
                        <Pressable onPress={() => { manual.current = false; fit(true); }} style={[s.recenter, { backgroundColor: surface, borderColor: border }]} accessibilityLabel="Show rider and my address">
                            <Ionicons name="locate" size={22} color={primary} />
                        </Pressable>
                    )}
                </View>

                <View style={[s.info, { paddingBottom: insets.bottom + 14 }]}>
                    {quiet ? (
                        <View style={[s.note, { backgroundColor: '#FEF3C7' }]}>
                            <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
                            <Text style={s.noteText}>His phone has not reported for a moment. The pin will move again as soon as it does.</Text>
                        </View>
                    ) : null}
                    {track.rider ? (
                        <View style={s.rider}>
                            <View style={[s.avatar, { backgroundColor: tint(primary) }]}><Ionicons name="person" size={22} color={primary} /></View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={[s.rName, { color: text }]} numberOfLines={1}>{track.rider.name}</Text>
                                <Text style={[s.barSub, { color: muted }]} numberOfLines={1}>
                                    {['Your delivery partner', track.rider.vehicle, track.rider.phoneMasked].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                        </View>
                    ) : null}
                    {track.deliveryPin ? (
                        <View style={[s.pin, { backgroundColor: tint(primary) }]}>
                            <Text style={[s.barSub, { color: muted }]}>Delivery PIN. Tell it to the rider</Text>
                            <Text style={[s.pinNo, { color: primary }]}>{String(track.deliveryPin).split('').join(' ')}</Text>
                        </View>
                    ) : null}
                </View>
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    bar: { position: 'absolute', left: 12, right: 12, minHeight: 64, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    barIc: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    barText: { flex: 1, marginHorizontal: 12 },
    barHead: { fontSize: 15, fontWeight: '800' },
    barSub: { fontSize: 12.5, fontWeight: '500', marginTop: 2 },
    barGo: { fontSize: 13, fontWeight: '800', marginRight: 2 },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden', elevation: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
    grab: { paddingTop: 8, paddingBottom: 12, paddingHorizontal: 20, alignItems: 'center' },
    handle: { width: 44, height: 5, borderRadius: 3, marginBottom: 12 },
    sheetHead: { fontSize: 19, fontWeight: '900', alignSelf: 'flex-start' },
    sheetSub: { fontSize: 13, fontWeight: '500', marginTop: 3, alignSelf: 'flex-start' },
    mapBox: { flex: 1, overflow: 'hidden' },
    recenter: { position: 'absolute', right: 12, bottom: 12, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    wait: { position: 'absolute', left: 12, right: 12, bottom: 12, borderRadius: 12, borderWidth: 1, padding: 10 },
    info: { paddingHorizontal: 16, paddingTop: 12 },
    note: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 10, marginBottom: 10 },
    noteText: { flex: 1, marginLeft: 8, fontSize: 12.5, fontWeight: '600', color: '#92400E' },
    rider: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    rName: { fontSize: 15, fontWeight: '800' },
    pin: { marginTop: 10, borderRadius: 14, padding: 12, alignItems: 'center' },
    pinNo: { fontSize: 26, fontWeight: '900', letterSpacing: 4, marginTop: 4 },
    bike: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    home: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E8E3E', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
});
