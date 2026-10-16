// Live map of the riders who shared their location in the last 5 minutes. Refreshes every 10 seconds while open.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Platform, ScrollView, Pressable, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Empty, Pill } from '../../components/owners/ui';
import { useRidersStore } from '../../store/owners/useRidersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchRiderLocations } from '../../api/owners/shopApi';
import { ago } from '../../utils/owners/riderRules';

const INDIA = { latitude: 22.5, longitude: 79, latitudeDelta: 20, longitudeDelta: 20 };

export default function OwnerRiderMapScreen() {
    const { background, primary, onPrimary, text, muted, surface, border, ok } = useBrand();
    const names = useRidersStore((s) => s.riders);
    const map = useRef(null);
    const fitted = useRef(false);
    const [pins, setPins] = useState(null);

    useFocusEffect(useCallback(() => {
        let alive = true;
        const tick = async () => {
            try {
                const r = await fetchRiderLocations();
                if (!alive) return;
                setPins(r.items || []);
                if (!fitted.current && r.items?.length && map.current) {
                    fitted.current = true;
                    const pts = r.items.map((p) => ({ latitude: p.lat, longitude: p.lng }));
                    setTimeout(() => map.current?.fitToCoordinates(pts, { edgePadding: { top: 80, right: 60, bottom: 220, left: 60 }, animated: true }), 300);
                }
            } catch (e) { useOwnerStore.getState().noteError(e); if (alive) setPins((x) => x || []); }
        };
        useRidersStore.getState().load({ quiet: true });
        tick();
        const t = setInterval(tick, 10000);
        return () => { alive = false; clearInterval(t); };
    }, []));

    const nameOf = (p) => p.name || names.find((r) => String(r.userId) === String(p.riderId))?.name || 'Rider';
    const focus = (p) => map.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Live map" />
            <View style={{ flex: 1 }}>
                <MapView
                    ref={map}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    style={StyleSheet.absoluteFill}
                    initialRegion={INDIA}
                    showsCompass={false}
                    toolbarEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                >
                    {(pins || []).map((p) => (
                        <Marker key={p.riderId} coordinate={{ latitude: p.lat, longitude: p.lng }} title={nameOf(p)} description={`${p.activeOrderCount || 0} on delivery · ${ago(p.at)}`} anchor={{ x: 0.5, y: 0.5 }}>
                            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: p.activeOrderCount ? primary : ok, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="bicycle" size={20} color={p.activeOrderCount ? onPrimary : '#FFFFFF'} />
                            </View>
                        </Marker>
                    ))}
                </MapView>
                {pins && !pins.length ? (
                    <View style={{ position: 'absolute', left: 16, right: 16, top: 16, backgroundColor: surface, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 14 }}>
                        <Text style={{ color: text, fontWeight: '800' }}>No rider is sharing his location</Text>
                        <Text style={{ color: muted, marginTop: 2, fontSize: 12 }}>A rider shows here while he is online with the app open.</Text>
                    </View>
                ) : null}
                {pins?.length ? (
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 18, maxHeight: 220 }}>
                        <ScrollView>
                            {pins.map((p) => (
                                <Pressable key={p.riderId} onPress={() => focus(p)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9 }}>
                                    <Ionicons name="bicycle" size={20} color={p.activeOrderCount ? primary : ok} />
                                    <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 12 }} numberOfLines={1}>{nameOf(p)}</Text>
                                    {p.activeOrderCount ? <Pill label={`${p.activeOrderCount} on delivery`} color={primary} /> : <Pill label="Free" color={ok} />}
                                    <Text style={{ color: muted, fontSize: 11, marginLeft: 8 }}>{ago(p.at)}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                ) : null}
            </View>
        </View>
    );
}
