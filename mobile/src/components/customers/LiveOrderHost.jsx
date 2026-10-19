// The Blinkit-style live delivery for the customer: a small bar above the tabs while an order is on its way, which opens into
// a map sheet that can be dragged: full screen, half screen, or shrunk back to the bar.
//
//   bar   : "Arriving in 8 min", the rider's name and how far away he is. Tap it to open the map.
//   half  : the map on top, the arrival time, the rider and the delivery PIN below.
//   full  : the same, with the map filling the screen.
// Drag the handle (the top of the sheet) up or down to change size; the Back button shrinks it to the bar.
//
// Mounted once in the navigator. The data comes from useLiveTrip (socket first, polling when the server asks for it).
import Reanimated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useMapStyle } from '../../utils/common/mapStyle';
import RiderTrack from '../common/RiderTrack';
import HomePin from '../common/HomePin';
import { useStoreSpot } from './storeLocation';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { tint } from './shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useLiveTripStore } from '../../store/customers/useLiveTripStore';
import { useLiveTrip } from '../../hooks/customers/useLiveTrip';
import { decodePolyline } from '../../utils/common/polyline';
import { onNotification, onMenuChanged } from '../../api/common/socket';
import { useMenuStore } from '../../store/customers/shopStores';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { playSfx, buzz } from '../../utils/common/sfx';
import { tr } from '../../i18n';

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

export default function LiveOrderHost({ routeName, onOpenOrder }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && user.role !== 'rider' && user.role !== 'admin';
    useLiveTrip(enabled);

    // Without a live connection (a guest who skipped login, or the connection is down) the menu is still read again every 20 s
    // while the app is open, and the moment the app comes back to the front.
    const shopper = !user || (user.role !== 'rider' && user.role !== 'admin');
    useEffect(() => {
        if (!shopper) return undefined;
        const load = () => { if (AppState.currentState === 'active') useMenuStore.getState().load(); };
        const t = setInterval(load, 20000);
        const t2 = setInterval(() => { if (AppState.currentState === 'active') useHomeStore.getState().load(); }, 30000);   // open / closed by the clock, and settings
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { useMenuStore.getState().load(); useHomeStore.getState().load(); } });
        return () => { clearInterval(t); clearInterval(t2); sub.remove(); };
    }, [shopper]);

    // The shop changed a dish (price, sold out for today, back in 2 hours...): the menu is read again at once, so the customer
    // sees exactly what the shop chose with no delay.
    useEffect(() => {
        if (!enabled) return undefined;
        return onMenuChanged(() => { useMenuStore.getState().load(); useHomeStore.getState().load(); });   // the dishes AND the shop's settings (show / hide sold-out dishes)
    }, [enabled]);

    // The shop's answer and the ride, heard as they happen: accepted, turned down (cancelled by the shop), out for delivery.
    // (The customer's own cancel is not announced to him; its sound plays where he taps Cancel.)
    useEffect(() => {
        if (!enabled) return undefined;
        const seen = new Map();   // orderId:status -> time, so one change sounds once
        return onNotification((n) => {
            const d = n?.data;
            if (n?.type !== 'order_status' || !d?.orderId) return;
            const key = d.orderId + ':' + d.status;
            if (Date.now() - (seen.get(key) || 0) < 15000) return;
            seen.set(key, Date.now());
            if (d.status === 'accepted') playSfx('orderAccepted');
            else if (d.status === 'cancelled') { playSfx('orderCancelled'); buzz(); }
            else if (d.status === 'out_for_delivery') { playSfx('outForDelivery'); buzz([0, 80, 90, 80, 90, 160]); }
        });
    }, [enabled]);

    const { orderId, orderNo, track, loc, route, eta: e, dest, quiet, sheet } = useLiveTripStore();
    const setSheet = useLiveTripStore((s) => s.setSheet);
    const { primary, text, muted, surface, border, background } = useBrand();
    const mapStyle = useMapStyle();
    const spot = useStoreSpot();   // the shop's pin: the start of the way
    const insets = useSafeAreaInsets();
    const { height: H } = useWindowDimensions();
    const now = useNow(20000);

    // the customer can slide the bar down out of the way; a small chip brings it back
    const [hidden, setHidden] = useState(false);
    const slide = useRef(new Animated.Value(0)).current;   // 0 = bar shown, 1 = bar hidden
    useEffect(() => { Animated.timing(slide, { toValue: hidden ? 1 : 0, duration: 280, useNativeDriver: true }).start(); }, [hidden, slide]);
    useEffect(() => { setHidden(false); }, [orderId]);
    // tell the active-order bar how much room this bar takes (the bar, or the small chip when it is hidden)
    const setLiveOffset = useLiveTripStore((s) => s.setLiveOffset);
    useEffect(() => {
        const visible = enabled && !!orderId && !!track && !HIDE_ON.includes(routeName) && sheet === 'bar';
        setLiveOffset(visible ? (hidden ? 54 : 126) : 0);
    }, [enabled, orderId, track, routeName, sheet, hidden, setLiveOffset]);

    const SHEET_H = Math.round(H * 0.93);
    const VISIBLE = useMemo(() => ({ bar: 0, half: Math.round(H * 0.58), full: SHEET_H }), [H, SHEET_H]);
    // The sheet's position lives on the UI thread (a shared value), so dragging follows the finger at the screen's full
    // frame rate, even while the map and the rider's marker are busy on the JavaScript side.
    const y = useSharedValue(SHEET_H);
    const startY = useSharedValue(SHEET_H);
    const sheetRef = useRef(sheet);
    sheetRef.current = sheet;

    const snapTo = useCallback((name) => {
        const to = SHEET_H - VISIBLE[name];
        y.value = withSpring(to, { damping: 20, stiffness: 240, mass: 0.8 });
    }, [y, SHEET_H, VISIBLE]);
    useEffect(() => { snapTo(orderId ? sheet : 'bar'); }, [sheet, orderId, snapTo]);

    // dragging the handle
    const settleDrag = useCallback((visible, vy) => {
        // a quick flick goes one step; a slow drag goes to the nearest size (vy in px per millisecond, up is negative)
        const order = ['bar', 'half', 'full'];
        let i = order.indexOf(sheetRef.current);
        if (Math.abs(vy) > 0.6) i = Math.max(0, Math.min(2, i + (vy < 0 ? 1 : -1)));
        else i = order.map((n) => Math.abs(VISIBLE[n] - visible)).reduce((b, d, k, a) => (d < a[b] ? k : b), 0);
        if (order[i] === sheetRef.current) snapTo(order[i]); else setSheet(order[i]);
    }, [VISIBLE, snapTo, setSheet]);
    const pan = useMemo(() => Gesture.Pan()
        .onStart(() => { 'worklet'; cancelAnimation(y); startY.value = y.value; })
        .onUpdate((e) => { 'worklet'; y.value = Math.min(SHEET_H, Math.max(SHEET_H - VISIBLE.full, startY.value + e.translationY)); })
        .onEnd((e) => { 'worklet'; runOnJS(settleDrag)(SHEET_H - y.value, e.velocityY / 1000); }),
    [y, startY, SHEET_H, VISIBLE, settleDrag]);
    const sheetMove = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

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
    const [moved, setMoved] = useState(false);   // the customer moved / zoomed the map: the recenter button shows
    useEffect(() => { first.current = null; manual.current = false; lastFit.current = 0; setMoved(false); }, [orderId]);
    const rider = loc ? { latitude: loc.lat, longitude: loc.lng } : null;
    if (rider && !first.current) first.current = rider;
    const [settle, setSettle] = useState(true);   // a marker is drawn again for a moment when it appears, then left alone
    useEffect(() => { setSettle(true); const t = setTimeout(() => setSettle(false), 1500); return () => clearTimeout(t); }, [!!rider, !!dest, primary, sheet]);   // the map is created when the sheet opens   // eslint-disable-line react-hooks/exhaustive-deps
    // the road (when Google drew one) and the bike sliding along it between pings; glide.line = the road still ahead of the bike
    const road = useMemo(() => (route?.source === 'google' ? decodePolyline(route.polyline) : []), [route?.source, route?.polyline]);


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
    const barBottom = insets.bottom + TAB_H + 18;

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {showBar ? (
                <>
                    <Animated.View
                        pointerEvents={hidden ? 'none' : 'auto'}
                        style={{ position: 'absolute', left: 12, right: 12, bottom: barBottom, opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, barBottom + 90] }) }] }}
                    >
                        <Pressable
                            onPress={() => setSheet('half')}
                            style={[s.bar, { position: 'relative', left: undefined, right: undefined, flexDirection: 'column', alignItems: 'stretch', backgroundColor: surface, borderColor: border }]}
                            accessibilityRole="button" accessibilityLabel={tr('Open live delivery map')}
                        >
                            {/* ONE card for a delivery on its way: what is happening, then View order and Track, and Hide */}
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={[s.barIc, { backgroundColor: primary }]}>
                                    <Ionicons name="bicycle" size={22} color="#FFFFFF" />
                                </View>
                                <View style={s.barText}>
                                    <Text style={[s.barHead, { color: text }]} numberOfLines={1}>{quiet ? tr('Reconnecting to your delivery partner') : t.head}</Text>
                                    <Text style={[s.barSub, { color: muted }]} numberOfLines={1}>{sub}</Text>
                                </View>
                                <Pressable onPress={() => setHidden(true)} hitSlop={8} style={[s.hide, { backgroundColor: tint(primary) }]} accessibilityRole="button" accessibilityLabel={tr('Hide')}>
                                    <Ionicons name="chevron-down" size={18} color={primary} />
                                </Pressable>
                            </View>
                            <View style={{ flexDirection: 'row', marginTop: 10 }}>
                                <Pressable onPress={() => onOpenOrder && onOpenOrder(String(orderId))} style={[s.act, { borderColor: primary, flex: 1 }]} accessibilityRole="button" accessibilityLabel={tr('View your active order')}>
                                    <Ionicons name="receipt-outline" size={16} color={primary} />
                                    <Text style={[s.actTxt, { color: primary }]}>{tr('View order')}</Text>
                                </Pressable>
                                <Pressable onPress={() => setSheet('half')} style={[s.act, { backgroundColor: primary, borderColor: primary, flex: 1, marginLeft: 8 }]} accessibilityRole="button">
                                    <Ionicons name="navigate" size={16} color="#FFFFFF" />
                                    <Text style={[s.actTxt, { color: '#FFFFFF' }]}>{tr('Track')}</Text>
                                </Pressable>
                            </View>
                        </Pressable>
                    </Animated.View>
                    <Animated.View
                        pointerEvents={hidden ? 'auto' : 'none'}
                        style={{ position: 'absolute', right: 14, bottom: barBottom, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }}
                    >
                        <Pressable onPress={() => setHidden(false)} style={[s.chip, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Show live delivery')}>
                            <Ionicons name="bicycle" size={20} color="#FFFFFF" />
                            <Ionicons name="chevron-up" size={16} color="#FFFFFF" style={{ marginLeft: 2 }} />
                        </Pressable>
                    </Animated.View>
                </>
            ) : null}

            <Reanimated.View
                pointerEvents={sheet === 'bar' ? 'none' : 'auto'}
                style={[s.sheet, { height: SHEET_H, backgroundColor: background, borderColor: border }, sheetMove]}
            >
                <GestureDetector gesture={pan}>
                <View style={s.grab}>
                    <View style={[s.handle, { backgroundColor: border }]} />
                    <Text style={[s.sheetHead, { color: text }]} numberOfLines={1}>{quiet ? tr('Reconnecting to your delivery partner') : t.head}</Text>
                    <Text style={[s.sheetSub, { color: muted }]} numberOfLines={1}>{sub}</Text>
                </View>
                </GestureDetector>

                <View style={s.mapBox}>
                    {sheet !== 'bar' && (rider || dest) ? (
                        <MapView
                            ref={map}
                            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                            customMapStyle={mapStyle}
                            style={StyleSheet.absoluteFill}
                            initialRegion={{ ...(dest || rider), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                            showsCompass={false} toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                            onPanDrag={() => { manual.current = true; setMoved(true); }}
                            onRegionChangeComplete={(_, g) => { if (g?.isGesture) { manual.current = true; setMoved(true); } }}
                            onMapReady={() => fit(true)}
                        >
                            {spot.on && spot.pinned ? (
                                <Marker coordinate={{ latitude: spot.lat, longitude: spot.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settle}>
                                    <View style={s.shop}><Ionicons name="storefront" size={15} color="#FFFFFF" /></View>
                                </Marker>
                            ) : null}
                            {rider ? (
                                    <RiderTrack road={road} loc={loc} dest={dest} orderId={orderId} color={primary} estimate={route?.source !== 'google'} title={tr('Delivery partner')} />
                            ) : null}
                            {dest ? (
                                <Marker coordinate={dest} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle}>
                                    <HomePin />
                                </Marker>
                            ) : null}
                        </MapView>
                    ) : null}
                    {!rider ? (
                        <View style={[s.wait, { backgroundColor: surface, borderColor: border }]}>
                            <Text style={[s.barSub, { color: muted }]}>{tr('Waiting for the delivery partner\'s location…')}</Text>
                        </View>
                    ) : (
                        <Pressable onPress={() => { manual.current = false; setMoved(false); fit(true); }} style={[s.recenter, { backgroundColor: surface, borderColor: border }, !moved && { display: 'none' }]} accessibilityLabel={tr('Show rider and my address')}>
                            <Ionicons name="locate" size={22} color={primary} />
                        </Pressable>
                    )}
                </View>

                <View style={[s.info, { paddingBottom: insets.bottom + 14 }]}>
                    {quiet ? (
                        <View style={[s.note, { backgroundColor: '#FEF3C7' }]}>
                            <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
                            <Text style={s.noteText}>{tr('His phone has not reported for a moment. The pin will move again as soon as it does.')}</Text>
                        </View>
                    ) : null}
                    {track.rider ? (
                        <View style={s.rider}>
                            <View style={[s.avatar, { backgroundColor: tint(primary), overflow: 'hidden' }]}>{track.rider.photo ? <Image source={{ uri: track.rider.photo }} style={{ width: 44, height: 44 }} contentFit="cover" /> : <Ionicons name="person" size={22} color={primary} />}</View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={[s.rName, { color: text }]} numberOfLines={1}>{track.rider.name}</Text>
                                <Text style={[s.barSub, { color: muted }]} numberOfLines={1}>
                                    {['Your delivery partner', track.rider.vehicle].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                            {track.rider.phone ? (
                                <Pressable onPress={() => Linking.openURL(`tel:${track.rider.phone}`).catch(() => { })} style={[s.call, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Call {name}', { name: track.rider.name })}>
                                    <Ionicons name="call" size={20} color="#FFFFFF" />
                                </Pressable>
                            ) : null}
                        </View>
                    ) : null}
                    {track.deliveryPin ? (
                        <View style={[s.pin, { backgroundColor: tint(primary) }]}>
                            <Text style={[s.barSub, { color: muted }]}>{tr('Delivery PIN. Tell it to the rider')}</Text>
                            <Text style={[s.pinNo, { color: primary }]}>{String(track.deliveryPin).split('').join(' ')}</Text>
                        </View>
                    ) : null}
                </View>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    bar: { position: 'absolute', left: 12, right: 12, minHeight: 64, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    barIc: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    barText: { flex: 1, marginHorizontal: 12 },
    barHead: { fontSize: 15, fontWeight: '800' },
    barSub: { fontSize: 12.5, fontWeight: '500', marginTop: 2 },
    act: { height: 38, borderRadius: 19, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    actTxt: { fontSize: 13.5, fontWeight: '800', marginLeft: 6 },
    hide: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    chip: { height: 44, minWidth: 64, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
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
    call: { width: 44, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    callTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginLeft: 6, paddingRight: 18 },
    pin: { marginTop: 10, borderRadius: 14, padding: 12, alignItems: 'center' },
    pinNo: { fontSize: 26, fontWeight: '900', letterSpacing: 4, marginTop: 4 },
    bike: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    shop: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    home: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E8E3E', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
});
