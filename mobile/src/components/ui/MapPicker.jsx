import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { showToast } from './shop';
import { useHomeStore } from '../../store/useHomeStore';

const FALLBACK = { latitude: 26.4499, longitude: 80.3319 };

export default function MapPicker({ visible, initial, onClose, onPick }) {
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, text, muted, surface, border, radius } = useBrand();
    const delivery = useHomeStore((st) => st.delivery);
    const map = useRef(null);
    const start = initial?.latitude ? initial
        : delivery?.latitude ? { latitude: delivery.latitude, longitude: delivery.longitude } : FALLBACK;
    const [center, setCenter] = useState(start);
    const [label, setLabel] = useState('');
    const [locating, setLocating] = useState(false);
    const [granted, setGranted] = useState(false);
    const [place, setPlace] = useState(null);
    const [ready, setReady] = useState(false);

    const goTo = (c, d = 0.004) => map.current?.animateToRegion({
        latitude: c.latitude, longitude: c.longitude, latitudeDelta: d, longitudeDelta: d,
    }, 500);

    useEffect(() => { if (visible) setCenter(start); else setReady(false); }, [visible]);

    // opened without a saved pin: if permission is already granted, start near the user
    useEffect(() => {
        if (!visible || !ready || initial?.latitude) return undefined;
        let on = true;
        (async () => {
            try {
                const perm = await Location.getForegroundPermissionsAsync();
                if (!on || perm.status !== 'granted') return;
                setGranted(true);
                const last = await Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 200 });
                if (on && last) goTo(last.coords);
            } catch (e) { /* stay on the shop */ }
        })();
        return () => { on = false; };
    }, [visible, ready]);

    // address text for wherever the pin is (waits until the map stops moving)
    useEffect(() => {
        if (!visible) return undefined;
        let on = true;
        const t = setTimeout(async () => {
            try {
                const [a] = await Location.reverseGeocodeAsync(center);
                if (!on || !a) return;
                setPlace(a);
                setLabel([...new Set([a.name, a.street, a.district, a.city, a.postalCode].filter(Boolean))].join(', '));
            } catch (e) { if (on) setLabel(''); }
        }, 500);
        return () => { on = false; clearTimeout(t); };
    }, [center, visible]);

    const locate = async () => {
        setLocating(true);
        try {
            const perm = await Location.requestForegroundPermissionsAsync();
            if (perm.status !== 'granted') {
                showToast('Location permission is off');
                if (!perm.canAskAgain) Linking.openSettings();
                return;
            }
            setGranted(true);
            if (!(await Location.hasServicesEnabledAsync())) { showToast('Turn on location (GPS) on your phone'); return; }
            const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            goTo(p.coords, 0.002);
        } catch (e) { showToast('Could not get your location'); } finally { setLocating(false); }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: surface }}>
                <MapView
                    ref={map} provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill}
                    initialRegion={{ ...start, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                    onMapReady={() => setReady(true)}
                    onRegionChangeComplete={(r) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
                    showsUserLocation={granted} showsMyLocationButton={false} toolbarEnabled={false}
                    loadingEnabled loadingIndicatorColor={primary}
                />
                <View pointerEvents="none" style={s.pinWrap}>
                    <Ionicons name="location-sharp" size={44} color={primary} />
                </View>

                <Pressable onPress={onClose} style={[s.back, { top: insets.top + 10, backgroundColor: surface }]}>
                    <Ionicons name="arrow-back" size={22} color={text} />
                </Pressable>

                <Pressable onPress={locate} style={[s.gps, { backgroundColor: surface, bottom: 170 + insets.bottom }]}>
                    {locating ? <ActivityIndicator color={primary} /> : <Ionicons name="locate" size={24} color={primary} />}
                </Pressable>

                <View style={[s.bar, { backgroundColor: surface, borderTopColor: border, paddingBottom: (insets.bottom || 0) + 14 }]}>
                    <Text style={[s.hint, { color: muted }]}>Move the map to place the pin</Text>
                    <Text style={[s.addr, { color: text }]} numberOfLines={2}>{label || 'Finding address...'}</Text>
                    <Pressable
                        onPress={() => onPick({
                            ...center, address: label,
                            city: place?.city || place?.subregion || '',
                            pincode: /^\d{6}$/.test(place?.postalCode || '') ? place.postalCode : '',
                            area: place?.district || place?.street || '',
                        })}
                        style={[s.btn, { backgroundColor: primary, borderRadius: radius }]}
                    >
                        <Text style={[s.btnTxt, { color: onPrimary }]}>Confirm location</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    pinWrap: { position: 'absolute', top: '50%', left: '50%', marginLeft: -22, marginTop: -44 },
    back: { position: 'absolute', left: 14, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    gps: { position: 'absolute', right: 14, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, elevation: 8 },
    hint: { fontSize: 11, fontWeight: '700' },
    addr: { fontSize: 14, fontWeight: '700', marginTop: 4, marginBottom: 12, minHeight: 36 },
    btn: { paddingVertical: 14, alignItems: 'center' },
    btnTxt: { fontSize: 15, fontWeight: '800' },
});