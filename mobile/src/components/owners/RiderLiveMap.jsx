// The rider on a map, moving live while he delivers this order (pushed over the socket as his phone reports).
// Starts from the last position the server knows and follows every update. Shows the customer's address, the road he is
// taking, when he arrives, and a warning when his phone has gone quiet.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useMapStyle } from '../../utils/common/mapStyle';
import RiderTrack from '../common/RiderTrack';
import HomePin from '../common/HomePin';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { onRiderLocation, onRiderRoute, onOrderEta, onRiderQuiet, watchOrder } from '../../api/common/socket';
import { decodePolyline } from '../../utils/common/polyline';
import { tr } from '../../i18n';

const ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
    return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : 'a while ago';
};
const dist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

export default function RiderLiveMap({ orderId, initial, destination, riderName }) {
    const { primary, muted, border, surface, text } = useBrand();
    const mapStyle = useMapStyle();
    const map = useRef(null);
    const bike = useRef(null);
    const first = useRef(null);
    const manual = useRef(false);     // the owner moved the map himself: stop pulling it back
    const [moved, setMoved] = useState(false);   // the owner moved / zoomed the map: the recenter button shows
    const [pos, setPos] = useState(initial?.lat != null ? { lat: initial.lat, lng: initial.lng, at: initial.at, heading: null } : null);
    const [route, setRoute] = useState(null);
    const [eta, setEta] = useState(null);
    const [quiet, setQuiet] = useState(false);
    const [, tick] = useState(0);

    useEffect(() => {
        const id = String(orderId);
        const leave = watchOrder(id);
        const mine = (p) => String(p?.orderId) === id;
        const offs = [
            onRiderLocation((p) => { if (mine(p) && typeof p.lat === 'number') { setPos({ lat: p.lat, lng: p.lng, at: p.at, heading: p.heading ?? null }); setQuiet(false); } }),
            onRiderRoute((p) => { if (mine(p)) setRoute(p); }),
            onOrderEta((p) => { if (mine(p)) setEta(p); }),
            onRiderQuiet((p) => { if (mine(p)) setQuiet(true); }),
        ];
        const t = setInterval(() => tick((n) => n + 1), 15000);   // keeps "x min ago" honest
        return () => { leave(); offs.forEach((f) => f()); clearInterval(t); };
    }, [orderId]);

    const rider = pos ? { latitude: pos.lat, longitude: pos.lng } : null;
    const dest = destination?.latitude != null && destination?.longitude != null ? destination : null;
    if (rider && !first.current) first.current = rider;
    const [settle, setSettle] = useState(true);   // a marker is drawn again for a moment when it appears, then left alone
    useEffect(() => { setSettle(true); const t = setTimeout(() => setSettle(false), 1500); return () => clearTimeout(t); }, [!!rider, !!dest, primary]);   // eslint-disable-line react-hooks/exhaustive-deps
    const road = useMemo(() => (route?.source === 'google' ? decodePolyline(route.polyline) : []), [route?.source, route?.polyline]);

    const fit = (force) => {
        if (!rider || (manual.current && !force)) return;
        map.current?.fitToCoordinates(dest ? [rider, dest] : [rider], { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
    };
    useEffect(() => {
        if (!rider) return;
        fit(false);
    }, [pos?.lat, pos?.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!rider) {
        return (
            <View style={[s.box, { borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="locate-outline" size={24} color={muted} />
                <Text style={{ color: muted, marginTop: 6, fontSize: 13 }}>{tr('Waiting for {v1}’s location', { v1: riderName || 'the rider' })}</Text>
            </View>
        );
    }
    const mins = eta?.etaAt ? Math.max(1, Math.ceil((new Date(eta.etaAt).getTime() - Date.now()) / 60000)) : null;
    const silentFor = pos.at ? Date.now() - new Date(pos.at).getTime() : 0;
    const warn = quiet || silentFor > 90000;   // the push for 3 minutes goes out on the server; the screen warns sooner
    return (
        <View>
            {warn ? (
                <View style={s.warn}>
                    <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
                    <Text style={s.warnText}>{tr('{v1}’s phone has not reported since {ago}. He may be in a weak signal area or have switched location off. You can call him.', { v1: riderName || 'The rider', ago: ago(pos.at) })}</Text>
                </View>
            ) : null}
            <View style={[s.box, { borderColor: border }]}>
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
                    <RiderTrack road={road} loc={pos} dest={dest} orderId={orderId} color={primary} estimate={route?.source !== 'google'} title={riderName || tr('Rider')} />
                    {dest ? (
                        <Marker coordinate={dest} title={tr('Customer')} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle}>
                                    <HomePin />
                        </Marker>
                    ) : null}
                </MapView>
                {mins ? (
                    <View style={[s.chip, { backgroundColor: surface, borderColor: border }]}>
                        <Text style={{ color: text, fontWeight: '800', fontSize: 13 }}>{mins <= 1 ? tr('Arriving now') : tr('{mins} min', { mins: mins })}{eta?.remainingM != null ? ` · ${dist(eta.remainingM)}` : ''}</Text>
                    </View>
                ) : null}
                <Pressable onPress={() => { manual.current = false; setMoved(false); fit(true); }} style={[s.recenter, { backgroundColor: surface, borderColor: border }, !moved && { display: 'none' }]} accessibilityLabel={tr('Show rider and customer')}>
                    <Ionicons name="locate" size={20} color={primary} />
                </Pressable>
            </View>
            <Text style={{ color: text, fontSize: 12, marginTop: 6 }}>{tr('Live · updated {ago}{v2}', { ago: ago(pos.at), v2: route?.source && route.source !== 'google' ? ' · straight-line estimate' : '' })}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    box: { height: 220, borderRadius: 14, overflow: 'hidden', borderWidth: 1, marginTop: 10 },
    warn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderRadius: 12, padding: 10, marginTop: 10 },
    warnText: { flex: 1, marginLeft: 8, fontSize: 12.5, fontWeight: '600', color: '#92400E' },
    chip: { position: 'absolute', left: 10, top: 10, borderRadius: 12, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12, elevation: 3 },
    recenter: { position: 'absolute', right: 10, bottom: 10, width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 3 },
    bike: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    home: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
});
