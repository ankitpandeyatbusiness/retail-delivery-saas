// src/components/ui/MapPicker.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator, StyleSheet, Linking, Platform, TextInput, Keyboard } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { showToast } from './shop';
import { useHomeStore } from '../../store/useHomeStore';

const FALLBACK = { latitude: 26.4499, longitude: 80.3319 };

export default function MapPicker({ visible, initial, onClose, onPick, startAtShop }) {
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, text, muted, surface, border, radius } = useBrand();
    const delivery = useHomeStore((st) => st.delivery);
    const map = useRef(null);

    const start = initial?.latitude ? initial
        : delivery?.latitude ? { latitude: delivery.latitude, longitude: delivery.longitude } : FALLBACK;

    const [center, setCenter] = useState(start);
    const [label, setLabel] = useState('');
    const [place, setPlace] = useState(null);
    const [resolving, setResolving] = useState(true);
    const [locating, setLocating] = useState(false);
    const [granted, setGranted] = useState(false);
    const [ready, setReady] = useState(false);   // map tiles/engine ready
    const [shown, setShown] = useState(false);   // Modal fully shown (mount MapView only after this)
    const [q, setQ] = useState('');
    const [searching, setSearching] = useState(false);

    const goTo = (c, d = 0.004) => map.current?.animateToRegion({
        latitude: c.latitude, longitude: c.longitude, latitudeDelta: d, longitudeDelta: d,
    }, 500);

    // reset every time the modal opens or closes
    useEffect(() => {
        if (visible) {
            setCenter(start);
            setPlace(null);
            setLabel('');
            setResolving(true);
        } else {
            setReady(false);
            setShown(false);
            setQ('');
        }
    }, [visible]);

    // opened without a saved pin: if permission is already granted, start near the user
    useEffect(() => {
        if (!visible || !ready || initial?.latitude || startAtShop) return undefined;
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
        // clear the previous address right away so Confirm can never send a stale one
        setPlace(null);
        setLabel('');
        setResolving(true);
        const t = setTimeout(async () => {
            try {
                const [a] = await Location.reverseGeocodeAsync(center);
                if (!on) return;
                if (a) {
                    setPlace(a);
                    setLabel([...new Set([a.name, a.street, a.district, a.city, a.postalCode].filter(Boolean))].join(', '));
                } else {
                    setPlace({});
                    setLabel('');
                }
            } catch (e) {
                // geocoder failed: still allow confirming the coordinates
                if (on) { setPlace({}); setLabel(''); }
            } finally {
                if (on) setResolving(false);
            }
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
            // same accuracy as the "Use my current location" button in the address form
            const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
            const c = { latitude: p.coords.latitude, longitude: p.coords.longitude };
            setCenter(c);      // update immediately, don't wait for the map event
            goTo(c, 0.002);
        } catch (e) { showToast('Could not get your location'); } finally { setLocating(false); }
    };

    const confirm = () => {
        if (resolving) return;
        // building/house + street; falls back to the full label if the geocoder gave neither
        const line1 = [...new Set([place?.name, place?.street].filter(Boolean))].join(', ') || label;
        onPick({
            ...center, address: label, line1,
            city: place?.city || place?.subregion || '',
            pincode: /^\d{6}$/.test(place?.postalCode || '') ? place.postalCode : '',
            area: place?.district || place?.street || '',
        });
    };

    const search = async () => {
        const term = q.trim();
        if (term.length < 3) { showToast('Type at least 3 letters'); return; }
        Keyboard.dismiss();
        setSearching(true);
        try {
            const r = await Location.geocodeAsync(term);
            if (!r.length) { showToast('Place not found. Try adding the city name.'); return; }
            const c = { latitude: r[0].latitude, longitude: r[0].longitude };
            setCenter(c);
            goTo(c, 0.003);
        } catch (e) {
            showToast('Search failed. Check your internet and try again.');
        } finally { setSearching(false); }
    };

    const canConfirm = !resolving;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            onRequestClose={onClose}
            onShow={() => setShown(true)}
            onDismiss={() => setShown(false)}
            statusBarTranslucent
        >
            <View style={{ flex: 1, backgroundColor: surface }}>
                {shown ? (
                    <MapView
                        ref={map}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                        style={StyleSheet.absoluteFill}
                        initialRegion={{ ...start, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                        onMapReady={() => setReady(true)}
                        onRegionChangeComplete={(r) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
                        showsUserLocation={granted} showsMyLocationButton={false} toolbarEnabled={false}
                        loadingEnabled loadingIndicatorColor={primary} loadingBackgroundColor={surface}
                    />
                ) : (
                    <View style={[StyleSheet.absoluteFill, s.loading]}>
                        <ActivityIndicator color={primary} />
                    </View>
                )}

                <View pointerEvents="none" style={s.pinWrap}>
                    <Ionicons name="location-sharp" size={44} color={primary} />
                </View>

                <Pressable onPress={onClose} style={[s.back, { top: insets.top + 10, backgroundColor: surface }]}>
                    <Ionicons name="arrow-back" size={22} color={text} />
                </Pressable>

                <View style={[s.search, { top: insets.top + 10, backgroundColor: surface }]}>
                    <Ionicons name="search" size={18} color={muted} />
                    <TextInput
                        value={q} onChangeText={setQ} onSubmitEditing={search}
                        placeholder="Search area, landmark or street" placeholderTextColor={muted}
                        returnKeyType="search" style={[s.searchInput, { color: text }]}
                    />
                    {searching ? <ActivityIndicator size="small" color={primary} /> : q ? (
                        <Pressable onPress={() => setQ('')} hitSlop={10}>
                            <Ionicons name="close-circle" size={18} color={muted} />
                        </Pressable>
                    ) : null}
                </View>

                <Pressable onPress={locate} disabled={locating} style={[s.gps, { backgroundColor: surface, bottom: 170 + insets.bottom }]}>
                    {locating ? <ActivityIndicator color={primary} /> : <Ionicons name="locate" size={24} color={primary} />}
                </Pressable>

                <View style={[s.bar, { backgroundColor: surface, borderTopColor: border, paddingBottom: (insets.bottom || 0) + 14 }]}>
                    <Text style={[s.hint, { color: muted }]}>Move the map to place the pin</Text>
                    <Text style={[s.addr, { color: text }]} numberOfLines={2}>
                        {resolving ? 'Finding address...' : (label || 'Pinned location')}
                    </Text>
                    <Pressable
                        onPress={confirm}
                        disabled={!canConfirm}
                        style={[s.btn, { backgroundColor: primary, borderRadius: radius, opacity: canConfirm ? 1 : 0.5 }]}
                    >
                        <Text style={[s.btnTxt, { color: onPrimary }]}>Confirm location</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    loading: { alignItems: 'center', justifyContent: 'center' },
    search: { position: 'absolute', left: 64, right: 14, height: 42, borderRadius: 21, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, elevation: 4 },
    searchInput: { flex: 1, marginLeft: 8, fontSize: 14, paddingVertical: 0 },
    pinWrap: { position: 'absolute', top: '50%', left: '50%', marginLeft: -22, marginTop: -44 },
    back: { position: 'absolute', left: 14, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    gps: { position: 'absolute', right: 14, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, elevation: 8 },
    hint: { fontSize: 11, fontWeight: '700' },
    addr: { fontSize: 14, fontWeight: '700', marginTop: 4, marginBottom: 12, minHeight: 36 },
    btn: { paddingVertical: 14, alignItems: 'center' },
    btnTxt: { fontSize: 15, fontWeight: '800' },
});