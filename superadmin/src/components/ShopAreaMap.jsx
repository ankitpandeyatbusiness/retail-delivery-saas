import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Circle } from 'react-native-maps';
import { useTheme, spacing, font, radius } from '../theme';

// The shop's pin and its delivery area, drawn on a small map you only look at (tap it to change them).
export default function ShopAreaMap({ latitude, longitude, radiusKm, onPress }) {
    const t = useTheme();
    const lat = Number(latitude); const lng = Number(longitude); const km = Number(radiusKm);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const hasArea = km > 0;
    const delta = Math.max(0.01, (hasArea ? km : 0.5) * 2.6 / 111);
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Delivery area on the map. Tap to change." style={({ pressed }) => ({ borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.9 : 1 })}>
            <View pointerEvents="none" style={{ height: 170 }}>
                <MapView
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    style={StyleSheet.absoluteFill}
                    region={{ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }}
                    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
                    toolbarEnabled={false} liteMode={Platform.OS === 'android'}
                >
                    <Marker coordinate={{ latitude: lat, longitude: lng }} />
                    {hasArea ? <Circle center={{ latitude: lat, longitude: lng }} radius={km * 1000} strokeWidth={2} strokeColor={t.primary} fillColor={`${t.primary}22`} /> : null}
                </MapView>
            </View>
            <View style={{ padding: spacing.md, backgroundColor: t.surface }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{hasArea ? `Delivers within ${km} km of the pin` : 'Shop pin (no delivery radius set)'}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>Tap to move the pin or change the delivery area.</Text>
            </View>
        </Pressable>
    );
}
