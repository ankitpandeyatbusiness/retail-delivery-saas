// The rider on a map, moving live while he delivers this order (pushed over the socket as his phone reports).
// Starts from the last position the server knows and follows every update. Shows the customer's address too.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { onRiderLocation, watchOrder } from '../../api/common/socket';

const ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
    return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : 'a while ago';
};

export default function RiderLiveMap({ orderId, initial, destination, riderName }) {
    const { primary, muted, border, surface, text } = useBrand();
    const map = useRef(null);
    const bike = useRef(null);
    const first = useRef(null);
    const [pos, setPos] = useState(initial?.lat != null ? { lat: initial.lat, lng: initial.lng, at: initial.at } : null);
    const [, tick] = useState(0);

    useEffect(() => {
        const leave = watchOrder(String(orderId));
        const off = onRiderLocation((p) => {
            if (String(p?.orderId) === String(orderId) && typeof p.lat === 'number') setPos({ lat: p.lat, lng: p.lng, at: p.at });
        });
        const t = setInterval(() => tick((n) => n + 1), 15000);   // keeps "x min ago" honest
        return () => { leave(); off(); clearInterval(t); };
    }, [orderId]);

    const rider = pos ? { latitude: pos.lat, longitude: pos.lng } : null;
    const dest = destination?.latitude != null && destination?.longitude != null ? destination : null;
    if (rider && !first.current) first.current = rider;
    useEffect(() => {
        if (!rider) return;
        if (first.current && bike.current?.animateMarkerToCoordinate) bike.current.animateMarkerToCoordinate(rider, 1500);
        map.current?.fitToCoordinates(dest ? [rider, dest] : [rider], { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
    }, [pos?.lat, pos?.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!rider) {
        return (
            <View style={[s.box, { borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="locate-outline" size={24} color={muted} />
                <Text style={{ color: muted, marginTop: 6, fontSize: 13 }}>Waiting for {riderName || 'the rider'}’s location</Text>
            </View>
        );
    }
    return (
        <View>
            <View style={[s.box, { borderColor: border }]}>
                <MapView
                    ref={map}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    style={StyleSheet.absoluteFill}
                    initialRegion={{ ...(dest || rider), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                    showsCompass={false} toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                >
                    <Marker ref={bike} coordinate={first.current || rider} title={riderName || 'Rider'} anchor={{ x: 0.5, y: 0.5 }}>
                        <View style={[s.bike, { backgroundColor: primary }]}><Ionicons name="bicycle" size={20} color="#FFFFFF" /></View>
                    </Marker>
                    {dest ? (
                        <Marker coordinate={dest} title="Customer" anchor={{ x: 0.5, y: 0.5 }}>
                            <View style={s.home}><Ionicons name="home" size={16} color="#FFFFFF" /></View>
                        </Marker>
                    ) : null}
                </MapView>
            </View>
            <Text style={{ color: text, fontSize: 12, marginTop: 6 }}>Live · updated {ago(pos.at)}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    box: { height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 1, marginTop: 10 },
    bike: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    home: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
});
