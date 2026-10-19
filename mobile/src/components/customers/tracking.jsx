// The "Track delivery" card on the order screen: who is bringing it, when it arrives, the delivery PIN,
// and a small map: the rider as a bike pin moving towards the customer's address pin.
// The rider pin needs a live location from the server (only while the rider is on the way and the phone is
// sending it). Until then the map shows the address alone. Everything comes from GET /orders/:id/tracking.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, Linking } from 'react-native';
import { Image } from 'expo-image';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import RiderTrack from '../common/RiderTrack';
import HomePin from '../common/HomePin';
import { decodePolyline } from '../../utils/common/polyline';
import { useStoreSpot } from './storeLocation';
import { useMapStyle } from '../../utils/common/mapStyle';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { tint } from './shop';
import { useLiveTripStore } from '../../store/customers/useLiveTripStore';
import { tr } from '../../i18n';

const HEADLINE = {
    finding_rider: 'Finding a delivery partner',
    rider_assigned: 'is getting your order',
    on_the_way: 'is on the way',
    delivered: 'Delivered',
    cancelled: 'Delivery cancelled',
};
const ICON = {
    finding_rider: 'search-outline',
    rider_assigned: 'bicycle-outline',
    on_the_way: 'navigate-outline',
    delivered: 'checkmark-circle-outline',
    cancelled: 'close-circle-outline',
};

const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

// "Arriving in about 12 min" for a near time, otherwise "Expected by 7:45 pm"
function etaText(t) {
    if (!t.etaAt || ['delivered', 'cancelled'].includes(t.state)) return '';
    const mins = Math.round((new Date(t.etaAt).getTime() - Date.now()) / 60000);
    if (t.etaSource === 'distance' && mins >= 0 && mins <= 90) return mins <= 1 ? 'Arriving now' : `Arriving in about ${mins} min`;
    return `Expected by ${clock(t.etaAt)}`;
}

export default function TrackingCard({ tracking: t, destination }) {
    const { primary, text, muted, surface, border } = useBrand();
    const mapStyle = useMapStyle();
    const map = useRef(null);
    const spot = useStoreSpot();   // the shop's pin: the start of the way
    // the shop and home pins are custom views: drawn again for a moment when they appear, then left alone (keeps the map smooth)
    const [settle, setSettle] = useState(true);
    const rider = t.riderLocation ? { latitude: t.riderLocation.lat, longitude: t.riderLocation.lng } : null;
    const dest = destination?.latitude != null && destination?.longitude != null ? destination : null;
    useEffect(() => {
        setSettle(true);
        const id = setTimeout(() => setSettle(false), 1500);
        return () => clearTimeout(id);
    }, [!!dest, !!rider, primary]);   // eslint-disable-line react-hooks/exhaustive-deps

    // the road Google drew (the scooter slides along it and the line is cut at the scooter; see RiderTrack)
    const road = useMemo(() => (t.route?.source === 'google' && t.route?.polyline ? decodePolyline(t.route.polyline) : []), [t.route?.source, t.route?.polyline]);

    // keep both ends in view as the rider moves, until the customer moves or zooms the map himself; then a recenter button shows
    const manual = useRef(false);
    const [moved, setMoved] = useState(false);
    const fit = (force) => {
        if (!map.current || !rider || (manual.current && !force)) return;
        map.current.fitToCoordinates(dest ? [rider, dest] : [rider], { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true });
    };
    useEffect(() => { fit(false); }, [t.riderLocation?.lat, t.riderLocation?.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    const name = t.rider?.name;
    const title = ['rider_assigned', 'on_the_way'].includes(t.state) && name ? `${name} ${HEADLINE[t.state]}` : HEADLINE[t.state] || 'Tracking';
    const eta = etaText(t);
    // the big live map (the sheet that opens over the app) is for this order when it is the one on the way
    const liveHere = useLiveTripStore((st) => !!st.orderId && String(st.orderId) === String(t.orderId));
    const openLive = useLiveTripStore((st) => st.setSheet);

    return (
        <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={s.head}>
                <View style={[s.ic, { backgroundColor: tint(primary) }]}>
                    <Ionicons name={ICON[t.state] || 'navigate-outline'} size={20} color={primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[s.title, { color: text }]}>{title}</Text>
                    {eta ? <Text style={[s.sub, { color: muted }]}>{eta}</Text> : null}
                </View>
            </View>

            {liveHere && t.state === 'on_the_way' ? (
                <Pressable onPress={() => openLive('full')} style={[s.liveBtn, { backgroundColor: primary }]} accessibilityRole="button">
                    <Ionicons name="map" size={18} color="#FFFFFF" />
                    <Text style={s.liveTxt}>{tr('Open live map')}</Text>
                </Pressable>
            ) : null}

            {t.rider ? (
                <View style={[s.rider, { borderTopColor: border }]}>
                    {/* the same round frame for a photo and for the no-photo icon, so the name always starts at the same place */}
                    <View style={[s.avatar, { backgroundColor: tint(primary) }]}>
                        {t.rider.photo
                            ? <Image source={{ uri: t.rider.photo }} style={s.avatarImg} contentFit="cover" />
                            : <Ionicons name="person" size={24} color={primary} />}
                    </View>
                    <View style={s.rText}>
                        <Text style={[s.rName, { color: text }]} numberOfLines={1}>{t.rider.name}</Text>
                        {[t.rider.vehicle, t.rider.phone ? null : t.rider.phoneMasked].filter(Boolean).length ? (
                            <Text style={[s.sub, { color: muted }]} numberOfLines={1}>{[t.rider.vehicle, t.rider.phone ? null : t.rider.phoneMasked].filter(Boolean).join(' · ')}</Text>
                        ) : null}
                        {t.rider.avgDeliveryMin ? (
                            <Text style={[s.sub, { color: muted }]} numberOfLines={2}>{tr('Usually delivers in about {min} min', { min: t.rider.avgDeliveryMin })}</Text>
                        ) : null}
                    </View>
                    {t.rider.phone ? (
                        <Pressable onPress={() => Linking.openURL(`tel:${t.rider.phone}`).catch(() => { })} style={[s.callBtn, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Call {name}', { name: t.rider.name })}>
                            <Ionicons name="call" size={18} color="#FFFFFF" />
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            {t.deliveryPin ? (
                <View style={[s.pin, { backgroundColor: tint(primary) }]}>
                    <Text style={[s.pinLabel, { color: muted }]}>{tr('Delivery PIN. Tell it to the rider')}</Text>
                    <Text style={[s.pinNo, { color: primary }]}>{String(t.deliveryPin).split('').join(' ')}</Text>
                </View>
            ) : null}

            {(rider || (dest && ['rider_assigned', 'on_the_way'].includes(t.state))) ? (
                <View style={[s.mapBox, { borderColor: border }]}>
                    <MapView
                        ref={map}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                        customMapStyle={mapStyle}
                        style={StyleSheet.absoluteFill}
                        initialRegion={{ ...(dest || rider), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                        showsCompass={false}
                        toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                        onPanDrag={() => { manual.current = true; setMoved(true); }}
                        onRegionChangeComplete={(_, g) => { if (g?.isGesture) { manual.current = true; setMoved(true); } }}
                        onMapReady={() => fit(true)}
                    >
                        {spot.on && spot.pinned ? (
                            <Marker coordinate={{ latitude: spot.lat, longitude: spot.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settle}>
                                <View style={s.shop}><Ionicons name="storefront" size={14} color="#FFFFFF" /></View>
                            </Marker>
                        ) : null}
                        {rider ? (
                            <RiderTrack road={road} loc={t.riderLocation} dest={dest} orderId="order" color={primary} estimate={t.route?.source !== 'google'} size={56} title={tr('Delivery partner')} />
                        ) : null}
                        {dest ? (
                            <Marker coordinate={dest} title={tr('Your address')} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle}>
                                <HomePin size={30} />
                            </Marker>
                        ) : null}
                    </MapView>
                    {rider && moved ? (
                        <Pressable onPress={() => { manual.current = false; setMoved(false); fit(true); }} style={[s.recenter, { backgroundColor: surface, borderColor: border }]} accessibilityLabel={tr('Show rider and my address')}>
                            <Ionicons name="locate" size={20} color={primary} />
                        </Pressable>
                    ) : null}
                    {!rider ? (
                        <View style={[s.wait, { backgroundColor: surface, borderColor: border }]}>
                            <Text style={[s.sub, { color: muted, marginTop: 0 }]}>{tr('Live location will appear once your order is picked up')}</Text>
                        </View>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 16 },
    head: { flexDirection: 'row', alignItems: 'center' },
    ic: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 15, fontWeight: '800' },
    sub: { fontSize: 12.5, fontWeight: '500', marginTop: 2 },
    rider: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarImg: { width: 46, height: 46 },
    rText: { flex: 1, minWidth: 0, marginLeft: 12, marginRight: 10, justifyContent: 'center' },
    rName: { fontSize: 15, fontWeight: '800' },
    callBtn: { width: 46, height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    callTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800', marginLeft: 6, paddingRight: 16 },
    liveBtn: { marginTop: 14, height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    liveTxt: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800', marginLeft: 8, paddingHorizontal: 40 },
    pin: { marginTop: 14, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pinLabel: { flex: 1, fontSize: 12.5, fontWeight: '600', marginRight: 12 },
    pinNo: { fontSize: 26, fontWeight: '900', letterSpacing: 4 },
    bike: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    shop: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F59E0B', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    recenter: { position: 'absolute', right: 8, bottom: 8, width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 3 },
    home: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E8E3E', borderWidth: 2, borderColor: '#FFFFFF', elevation: 3 },
    wait: { position: 'absolute', left: 8, right: 8, bottom: 8, borderRadius: 10, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10 },
    mapBox: { marginTop: 14, height: 190, borderRadius: 14, overflow: 'hidden', borderWidth: 1 },
});
