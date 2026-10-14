// The "Track delivery" card on the order screen: who is bringing it, when it arrives, the delivery PIN,
// and a small map: the rider as a bike pin moving towards the customer's address pin.
// The rider pin needs a live location from the server (only while the rider is on the way and the phone is
// sending it). Until then the map shows the address alone. Everything comes from GET /orders/:id/tracking.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tint } from './shop';

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
    const map = useRef(null);
    // a custom marker view is drawn once, then frozen (keeps the map smooth). Updated when the rider moves.
    const [settle, setSettle] = useState(true);
    useEffect(() => {
        setSettle(true);
        const id = setTimeout(() => setSettle(false), 600);
        return () => clearTimeout(id);
    }, [t.riderLocation?.lat, t.riderLocation?.lng, primary]);

    const rider = t.riderLocation ? { latitude: t.riderLocation.lat, longitude: t.riderLocation.lng } : null;
    const dest = destination?.latitude != null && destination?.longitude != null ? destination : null;

    // keep both pins in view as the rider moves
    useEffect(() => {
        if (!map.current || !rider) return;
        const pts = dest ? [rider, dest] : [rider];
        map.current.fitToCoordinates(pts, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
    }, [t.riderLocation?.lat, t.riderLocation?.lng]);

    const name = t.rider?.name;
    const title = ['rider_assigned', 'on_the_way'].includes(t.state) && name ? `${name} ${HEADLINE[t.state]}` : HEADLINE[t.state] || 'Tracking';
    const eta = etaText(t);

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

            {t.rider ? (
                <View style={[s.rider, { borderTopColor: border }]}>
                    <Ionicons name="person-circle-outline" size={34} color={muted} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[s.rName, { color: text }]}>{t.rider.name}</Text>
                        <Text style={[s.sub, { color: muted }]}>
                            {[t.rider.vehicle, t.rider.phoneMasked].filter(Boolean).join(' · ')}
                        </Text>
                    </View>
                </View>
            ) : null}

            {t.deliveryPin ? (
                <View style={[s.pin, { backgroundColor: tint(primary) }]}>
                    <Text style={[s.pinLabel, { color: muted }]}>Delivery PIN. Tell it to the rider</Text>
                    <Text style={[s.pinNo, { color: primary }]}>{String(t.deliveryPin).split('').join(' ')}</Text>
                </View>
            ) : null}

            {(rider || (dest && ['rider_assigned', 'on_the_way'].includes(t.state))) ? (
                <View style={[s.mapBox, { borderColor: border }]}>
                    <MapView
                        ref={map}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                        style={StyleSheet.absoluteFill}
                        initialRegion={{ ...(dest || rider), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                        showsCompass={false}
                        toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                    >
                        {rider ? (
                            <Marker coordinate={rider} title="Delivery partner" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settle}>
                                <View style={[s.bike, { backgroundColor: primary }]}>
                                    <Ionicons name="bicycle" size={20} color="#FFFFFF" />
                                </View>
                            </Marker>
                        ) : null}
                        {dest ? (
                            <Marker coordinate={dest} title="Your address" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settle}>
                                <View style={s.home}>
                                    <Ionicons name="home" size={16} color="#FFFFFF" />
                                </View>
                            </Marker>
                        ) : null}
                    </MapView>
                    {!rider ? (
                        <View style={[s.wait, { backgroundColor: surface, borderColor: border }]}>
                            <Text style={[s.sub, { color: muted, marginTop: 0 }]}>Live location will appear once your order is picked up</Text>
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
    rName: { fontSize: 14, fontWeight: '700' },
    pin: { marginTop: 14, borderRadius: 14, padding: 12, alignItems: 'center' },
    pinLabel: { fontSize: 12, fontWeight: '600' },
    pinNo: { fontSize: 26, fontWeight: '900', letterSpacing: 4, marginTop: 4 },
    bike: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    home: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E8E3E', borderWidth: 2, borderColor: '#FFFFFF', elevation: 3 },
    wait: { position: 'absolute', left: 8, right: 8, bottom: 8, borderRadius: 10, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10 },
    mapBox: { marginTop: 14, height: 190, borderRadius: 14, overflow: 'hidden', borderWidth: 1 },
});
