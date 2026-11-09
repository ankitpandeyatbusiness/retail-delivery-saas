// The shop's pin and its delivery area, drawn on a small map you only look at (tap it to move the pin). Same look as the platform team's shop page.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Circle } from 'react-native-maps';
import { useBrand, alpha } from '../common/kit';
import { tr } from '../../i18n';

export default function ShopAreaMap({ latitude, longitude, radiusKm, onPress }) {
    const { primary, text, muted, surface, border } = useBrand();
    const lat = Number(latitude); const lng = Number(longitude); const km = Number(radiusKm);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const hasArea = km > 0;
    const delta = Math.max(0.01, ((hasArea ? km : 0.5) * 2.6) / 111);
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: border, marginBottom: 14, opacity: pressed ? 0.9 : 1 })}>
            <View pointerEvents="none" style={{ height: 170 }}>
                <MapView
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    style={StyleSheet.absoluteFill}
                    region={{ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }}
                    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
                    toolbarEnabled={false} liteMode={Platform.OS === 'android'}
                >
                    <Marker coordinate={{ latitude: lat, longitude: lng }} />
                    {hasArea ? <Circle center={{ latitude: lat, longitude: lng }} radius={km * 1000} strokeWidth={2} strokeColor={primary} fillColor={alpha(primary, 0.13)} /> : null}
                </MapView>
            </View>
            <View style={{ padding: 12, backgroundColor: surface }}>
                <Text style={{ color: text, fontWeight: '800' }}>{hasArea ? tr('Delivers within {km} km of the pin', { km }) : tr('Shop pin (no delivery radius set)')}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Tap to move the pin. The address below is filled in for you.')}</Text>
            </View>
        </Pressable>
    );
}
