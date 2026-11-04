import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Linking, Platform, TextInput, Keyboard } from 'react-native';
import { ActivityIndicator } from './Loading';
import MapView, { PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import { Button, Chip } from './ui';
import { toast } from './feedback';
import Icon from './Icon';
import { searchPlaces, reversePlace, placePoint } from '../api/shopsApi';

const FALLBACK = { latitude: 20.5937, longitude: 78.9629 };   // middle of India, only until the first search or GPS fix

/*
 * Point to the shop on a Google map.
 *   - move the map, the pin stays in the middle
 *   - search a place or street, or use "my location" (works when you stand at the shop, or far from it)
 *   - onPick({ latitude, longitude, address, city, pincode })
 */
// withRadius: the delivery area is drawn as a circle round the pin, with chips and - / + to set its radius while you look at it. radiusKm is where it starts.
const RADII = [1, 2, 3, 5, 8, 10, 15];
const GOOGLE_NOTE = {
    no_key: 'Google search is off here (no Google key on the server). Showing OpenStreetMap results instead.',
    budget: 'The month\'s Google search allowance is used up. Showing OpenStreetMap results instead.',
    refused: 'Google refused the search (the key is not allowed to use Places). Showing OpenStreetMap results instead.',
    error: 'Google search did not answer. Showing OpenStreetMap results instead.',
};
export default function MapPicker({ visible, initial, onClose, onPick, withRadius, radiusKm }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const map = useRef(null);
    const start = initial?.latitude != null && initial?.longitude != null
        ? { latitude: Number(initial.latitude), longitude: Number(initial.longitude) } : FALLBACK;
    const hasStart = start !== FALLBACK;

    const [center, setCenter] = useState(start);
    const [shown, setShown] = useState(false);
    const [ready, setReady] = useState(false);
    const [place, setPlace] = useState(null);
    const [resolving, setResolving] = useState(true);
    const [q, setQ] = useState('');
    const [searching, setSearching] = useState(false);
    const [matches, setMatches] = useState([]);
    const [locating, setLocating] = useState(false);
    const [granted, setGranted] = useState(false);
    const [barH, setBarH] = useState(230);   // the bottom panel's real height: the location button sits just above it, whatever is in it
    const [google, setGoogle] = useState('ok');   // why Google gave nothing, when it did not
    const [radius, setRadius] = useState(Number(radiusKm) > 0 ? Number(radiusKm) : 5);
    useEffect(() => { if (visible && Number(radiusKm) > 0) setRadius(Number(radiusKm)); }, [visible, radiusKm]);

    const skipAuto = useRef(false);
    const nearRef = useRef(hasStart ? start : null);   // suggestions favour places near the map
    const seq = useRef(0);
    const centerRef = useRef(start);     // where the map is looking now
    const movedRef = useRef(false);     // false until the map was moved or located: before that the centre is only the middle of India

    // matching places appear while typing
    useEffect(() => {
        if (skipAuto.current) { skipAuto.current = false; return undefined; }
        const term = q.trim();
        if (term.length < 3) { setMatches([]); return undefined; }
        const id = setTimeout(async () => {
            const mine = ++seq.current;
            setSearching(true);
            try {
                const r = await searchPlaces(term, nearRef.current || (movedRef.current ? centerRef.current : null));
                if (mine === seq.current) { setMatches(r.items); setGoogle(r.google || 'ok'); }
            } catch { /* the Search key still works */ } finally { if (mine === seq.current) setSearching(false); }
        }, 350);
        return () => clearTimeout(id);
    }, [q]);

    const goTo = (c, d = 0.004) => map.current?.animateToRegion({ latitude: c.latitude, longitude: c.longitude, latitudeDelta: d, longitudeDelta: d }, 350);

    useEffect(() => {
        if (visible) { setCenter(start); setPlace(null); setResolving(true); } else { setShown(false); setReady(false); setQ(''); setMatches([]); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    // address text for wherever the pin rests
    useEffect(() => {
        if (!visible) return undefined;
        let on = true;
        setPlace(null);
        setResolving(true);
        const id = setTimeout(async () => {
            try {
                const r = await reversePlace(center.latitude, center.longitude);
                if (on && r.place) { setPlace({ formatted: r.place.name, city: r.place.city, postalCode: r.place.pincode }); return; }
                const [a] = await Location.reverseGeocodeAsync(center);   // the phone's own geocoder as a second try
                if (on) setPlace(a || {});
            } catch {
                try { const [a] = await Location.reverseGeocodeAsync(center); if (on) setPlace(a || {}); } catch { if (on) setPlace({}); }
            } finally { if (on) setResolving(false); }
        }, 500);
        return () => { on = false; clearTimeout(id); };
    }, [center, visible]);

    const label = place ? (place.formatted || [...new Set([place.name, place.street, place.district, place.city, place.postalCode].filter(Boolean))].join(', ')) : '';

    const locate = async () => {
        setLocating(true);
        try {
            const perm = await Location.requestForegroundPermissionsAsync();
            if (perm.status !== 'granted') {
                toast('Location permission is off', 'error');
                if (!perm.canAskAgain) Linking.openSettings();
                return;
            }
            setGranted(true);
            if (!(await Location.hasServicesEnabledAsync())) { toast('Turn on location (GPS) on your phone', 'error'); return; }
            const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
            const c = { latitude: p.coords.latitude, longitude: p.coords.longitude };
            setCenter(c);
            nearRef.current = c;
            goTo(c, 0.002);
        } catch { toast('Could not get your location', 'error'); } finally { setLocating(false); }
    };

    // no saved point: start where the phone is, if it is already allowed
    useEffect(() => {
        if (!visible || !ready || hasStart) return undefined;
        let on = true;
        (async () => {
            try {
                const perm = await Location.getForegroundPermissionsAsync();
                if (!on || perm.status !== 'granted') return;
                setGranted(true);
                const last = await Location.getLastKnownPositionAsync({ maxAge: 300000 });
                if (on && last) { setCenter(last.coords); goTo(last.coords, 0.01); }
            } catch { /* stay */ }
        })();
        return () => { on = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, ready]);

    const choose = async (m) => {
        let pt = m;
        if (m.latitude == null && m.placeId) {
            try { pt = { ...m, ...(await placePoint(m.placeId)).place }; } catch { toast('Could not open this place', 'error'); return; }
        }
        const c = { latitude: pt.latitude, longitude: pt.longitude };
        setMatches([]);
        skipAuto.current = true;   // do not search again for the text we just filled in
        setQ(m.title || m.name.split(',')[0]);
        setCenter(c);
        goTo(c, 0.003);
    };

    const search = async () => {
        const term = q.trim();
        if (term.length < 3) { toast('Type at least 3 letters', 'error'); return; }
        Keyboard.dismiss();
        setSearching(true);
        try {
            const r = await searchPlaces(term, nearRef.current);
            if (!r.items.length) { setMatches([]); toast('Place not found. Add the city name.', 'error'); return; }
            if (r.items.length === 1) { choose(r.items[0]); return; }
            setMatches(r.items);
        } catch { toast('Search failed. Check the internet.', 'error'); } finally { setSearching(false); }
    };

    const confirm = () => {
        if (resolving) return;
        onPick({
            latitude: Number(center.latitude.toFixed(6)),
            longitude: Number(center.longitude.toFixed(6)),
            address: label,
            line: [...new Set([place?.name, place?.street].filter(Boolean))].join(', ') || label,
            city: place?.city || place?.subregion || '',
            pincode: /^\d{6}$/.test(place?.postalCode || '') ? place.postalCode : '',
            ...(withRadius ? { radiusKm: radius } : {}),
        });
    };

    return (
        <Modal visible={visible} animationType="fade" onRequestClose={onClose} onShow={() => setShown(true)} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: t.surface }}>
                {shown ? (
                    <MapView
                        ref={map}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                        style={StyleSheet.absoluteFill}
                        initialRegion={{ ...start, latitudeDelta: hasStart ? (withRadius ? Math.max(0.005, radius * 2.6 / 111) : 0.005) : 20, longitudeDelta: hasStart ? (withRadius ? Math.max(0.005, radius * 2.6 / 111) : 0.005) : 20 }}
                        onMapReady={() => setReady(true)}
                        onRegionChangeComplete={(r) => { const c = { latitude: r.latitude, longitude: r.longitude }; centerRef.current = c; if (r.latitudeDelta < 15) movedRef.current = true; setCenter(c); }}
                        mapPadding={{ top: insets.top + 64, right: 8, bottom: 0, left: 0 }}
                        showsUserLocation={granted}
                        showsMyLocationButton={false}
                        toolbarEnabled={false}
                        loadingEnabled
                        loadingIndicatorColor={t.primary}
                        loadingBackgroundColor={t.surface}
                    >
                        {withRadius ? <Circle center={center} radius={radius * 1000} strokeWidth={2} strokeColor={t.primary} fillColor={`${t.primary}22`} /> : null}
                    </MapView>
                ) : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={t.primary} /></View>}

                {/* the map is padded at the top (for the compass), so its centre is lower: the pin follows */}
                <View pointerEvents="none" style={[s.pin, { marginTop: -46 + (insets.top + 64) / 2 }]}><Icon name="pin" size={46} color={t.primary} filled /></View>

                <Pressable onPress={onClose} style={[s.round, { top: insets.top + 10, left: 14, backgroundColor: t.surface }]}>
                    <Icon name="back" size={22} color={t.text} />
                </Pressable>
                <View style={[s.search, { top: insets.top + 10, backgroundColor: t.surface }]}>
                    <Icon name="search" size={18} color={t.muted} />
                    <TextInput
                        value={q}
                        onChangeText={(v) => { setQ(v); if (matches.length) setMatches([]); }}
                        onSubmitEditing={search}
                        placeholder="Search shop, area, street or city"
                        placeholderTextColor={t.muted}
                        returnKeyType="search"
                        style={{ flex: 1, marginLeft: 8, color: t.text, fontSize: font.md, paddingVertical: 0 }}
                    />
                    {searching ? <ActivityIndicator size="small" color={t.primary} /> : null}
                </View>

                {matches.length ? (
                    <View style={[s.matches, { top: insets.top + 58, backgroundColor: t.surface }]}>
                        {matches.map((m, i) => (
                            <Pressable key={`${m.latitude},${m.longitude},${i}`} onPress={() => choose(m)} style={{ paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.border }}>
                                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700' }} numberOfLines={1}>{m.title || m.name}</Text>
                                {m.subtitle ? <Text style={{ color: t.muted, fontSize: font.sm }} numberOfLines={1}>{m.subtitle}</Text> : null}
                                {m.source ? <Text style={{ color: m.source === 'google' ? t.success : t.muted, fontSize: font.xs, fontWeight: '700', marginTop: 1 }}>{m.source === 'google' ? 'Google' : 'OpenStreetMap'}</Text> : null}
                            </Pressable>
                        ))}
                        {google !== 'ok' && GOOGLE_NOTE[google] ? <Text style={{ color: t.warn, fontSize: font.xs, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>{GOOGLE_NOTE[google]}</Text> : null}
                    </View>
                ) : null}

                <Pressable onPress={locate} disabled={locating} style={[s.round, { right: 14, bottom: barH + 14, backgroundColor: t.surface, width: 50, height: 50, borderRadius: 25 }]}>
                    {locating ? <ActivityIndicator color={t.primary} /> : <Icon name="pin" size={24} color={t.primary} />}
                </Pressable>

                <View onLayout={(e) => setBarH(e.nativeEvent.layout.height)} style={[s.bar, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
                    <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>Move the map so the pin is on the shop</Text>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700', marginTop: 4, minHeight: 40 }} numberOfLines={2}>
                        {resolving ? 'Finding address...' : (label || 'Pinned location')}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: font.xs, marginBottom: spacing.md }}>
                        {center.latitude.toFixed(6)}, {center.longitude.toFixed(6)}
                    </Text>
                    {withRadius ? (
                        <View style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800' }}>Delivery area: {radius} km round the pin</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Pressable onPress={() => setRadius((r) => Math.max(0.5, Math.round((r - 0.5) * 10) / 10))} hitSlop={8} style={[s.step, { borderColor: t.border }]}><Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>−</Text></Pressable>
                                    <Pressable onPress={() => setRadius((r) => Math.min(50, Math.round((r + 0.5) * 10) / 10))} hitSlop={8} style={[s.step, { borderColor: t.border, marginLeft: 8 }]}><Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>+</Text></Pressable>
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                                {RADII.map((r) => <Chip key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}
                            </View>
                        </View>
                    ) : null}
                    <Button title="Use this location" icon="check" onPress={confirm} disabled={resolving} />
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    step: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    pin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -23, marginTop: -46 },
    round: { position: 'absolute', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    search: { position: 'absolute', left: 64, right: 14, height: 42, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, elevation: 4 },
    matches: { position: 'absolute', left: 14, right: 14, borderRadius: 16, elevation: 8, overflow: 'hidden' },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 10 },
});
