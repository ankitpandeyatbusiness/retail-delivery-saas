// Pick the shop's place on a map: drag the map under the pin, or use the phone's position. The circle shows how far
// the shop delivers. Used by the delivery area screen.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Platform, StyleSheet, Pressable } from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { Button } from './ui';
import { showToast } from '../customers/shop';
import { ListShimmer } from './shimmer';
import { tr } from '../../i18n';

const FALLBACK = { latitude: 22.5, longitude: 79 };

export function PinMap({ visible, initial, radiusKm, onClose, onPick }) {
    const insets = useSafeAreaInsets();
    const { background, text, muted, primary, surface, border } = useBrand();
    const map = useRef(null);
    const start = Number.isFinite(initial?.latitude) ? initial : FALLBACK;
    const [center, setCenter] = useState(start);
    const [ready, setReady] = useState(false);
    const [locating, setLocating] = useState(false);

    useEffect(() => { if (visible) { setCenter(start); setReady(false); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

    const useMine = async () => {
        setLocating(true);
        try {
            const p = await Location.requestForegroundPermissionsAsync();
            if (!p.granted) { showToast(tr('Allow location access to use your position')); return; }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setCenter(c);
            map.current?.animateToRegion({ ...c, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
        } catch (e) { showToast(tr('Could not find your position')); } finally { setLocating(false); }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: background }}>
                <View style={{ flex: 1 }}>
                    {visible ? (
                        <MapView
                            ref={map}
                            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                            style={StyleSheet.absoluteFill}
                            initialRegion={{ ...start, latitudeDelta: Number.isFinite(initial?.latitude) ? 0.02 : 18, longitudeDelta: Number.isFinite(initial?.latitude) ? 0.02 : 18 }}
                            onMapReady={() => setReady(true)}
                            onRegionChangeComplete={(r) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
                            showsCompass={false}
                            toolbarEnabled={false}
                            rotateEnabled={false}
                            pitchEnabled={false}
                        >
                            {radiusKm > 0 ? <Circle center={center} radius={radiusKm * 1000} strokeColor={primary} strokeWidth={2} fillColor={alpha(primary, 0.12)} /> : null}
                        </MapView>
                    ) : null}
                    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="location" size={42} color={primary} style={{ marginBottom: 42 }} />
                    </View>
                    {!ready ? <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]}><ListShimmer count={2} /></View> : null}
                    <Pressable onPress={onClose} hitSlop={10} style={{ position: 'absolute', top: insets.top + 10, left: 14, width: 42, height: 42, borderRadius: 21, backgroundColor: surface, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="close" size={22} color={text} />
                    </Pressable>
                </View>
                <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 12) + 4, backgroundColor: background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }}>
                    <Text style={{ color: muted, textAlign: 'center', marginBottom: 10 }}>{tr('Move the map so the pin is on your shop')}</Text>
                    <Button label={tr('Use my position')} icon="locate" kind="ghost" working={locating} disabled={locating} onPress={useMine} style={{ marginBottom: 8 }} />
                    <Button label={tr('Set shop here')} icon="checkmark" onPress={() => onPick(center)} />
                </View>
            </View>
        </Modal>
    );
}
