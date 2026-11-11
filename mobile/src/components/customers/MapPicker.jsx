// src/components/ui/MapPicker.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Linking, Platform, TextInput, Keyboard, ScrollView, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '../common/Loading';
import { Skel } from '../common/motion';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { showToast } from './shop';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useIsDesktopWeb } from '../../utils/common/layout';
import { suggestPlaces, placeById } from '../../api/customers/geoApi';
import { fetchAddresses } from '../../api/customers/shopApi';
import { readCache, writeCache } from '../../utils/common/cache';
import { LineShimmer } from '../owners/shimmer';
import { tr } from '../../i18n';

const FALLBACK = { latitude: 26.4499, longitude: 80.3319 };

// straight-line km between two {latitude, longitude} points
const kmBetween = (a, b) => {
    const r = (d) => (d * Math.PI) / 180;
    const x = Math.sin(r(b.latitude - a.latitude) / 2) ** 2
        + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
};
const kmText = (k) => (k == null ? '' : k < 1 ? `${Math.max(50, Math.round(k * 10) * 100)} m` : k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`);

// One suggestion: what it is, where, how far, and whether this shop delivers there
function PlaceRow({ c, onPress }) {
    const { primary, text, muted, border, error } = useBrand();
    const desk = useIsDesktopWeb();
    const icon = c.kind === 'saved' ? 'home-outline' : c.kind === 'recent' ? 'time-outline' : 'location-outline';
    return (
        <Pressable onPress={onPress} style={({ hovered }) => [s.row, { borderBottomColor: border }, desk && { borderRadius: 12, borderBottomWidth: 0, cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms' }, desk && hovered && { backgroundColor: `${primary}1A` }]}>
            <Ionicons name={icon} size={20} color={primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.rowTitle, { color: text }]} numberOfLines={1}>{c.title}</Text>
                {c.subtitle ? <Text style={[s.rowSub, { color: muted }]} numberOfLines={1}>{c.subtitle}</Text> : null}
            </View>
            <View style={s.rowR}>
                {c.distanceKm != null ? <Text style={[s.rowKm, { color: text }]}>{kmText(c.distanceKm)}</Text> : null}
                {c.deliverable === true ? <Text style={[s.rowBadge, { color: '#0F8A3C' }]}>{tr('Delivers here')}</Text> : null}
                {c.deliverable === false ? <Text style={[s.rowBadge, { color: error }]}>{tr('Outside area')}</Text> : null}
            </View>
        </Pressable>
    );
}

// forShop: the SHOP OWNER is pinning his own shop (shop settings): no saved customer addresses, and no "delivers here" badges
export default function MapPicker({ visible, initial, onClose, onPick, startAtShop, forShop }) {
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, text, muted, surface, border, radius, background } = useBrand();
    const desk = useIsDesktopWeb();   // a browser at least 1024 px wide: a centred card with the search on the left and a big map (false in the phone app)
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
    const { width: winW, height: winH } = useWindowDimensions();
    const user = useAuthStore((st) => st.user);
    const [focused, setFocused] = useState(false);
    const [results, setResults] = useState(null);      // null = nothing asked yet, [] = nothing found
    const [suggesting, setSuggesting] = useState(false);
    const [me, setMe] = useState(null);                // the customer's own position, when we know it
    const [recents, setRecents] = useState([]);
    const [saved, setSaved] = useState([]);
    const askId = useRef(0);

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
                if (on && last) { setMe({ latitude: last.coords.latitude, longitude: last.coords.longitude }); goTo(last.coords); }
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
                showToast(tr('Location permission is off'));
                if (!perm.canAskAgain) Linking.openSettings();
                return;
            }
            setGranted(true);
            if (!(await Location.hasServicesEnabledAsync())) { showToast(tr('Turn on location (GPS) on your phone')); return; }
            // same accuracy as the "Use my current location" button in the address form
            const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
            const c = { latitude: p.coords.latitude, longitude: p.coords.longitude };
            setMe(c);
            setCenter(c);      // update immediately, don't wait for the map event
            goTo(c, 0.002);
        } catch (e) { showToast(tr('Could not get your location')); } finally { setLocating(false); }
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
            state: place?.region || '',
        });
    };

    /* ---------------- smart place search ----------------
       - results come from the server, nearest to the customer first (own GPS if known, else the map centre)
       - each shows its distance and whether this shop delivers there
       - empty box: saved addresses and recent searches, nearest first */
    const measureFrom = me || center;

    // Where the customer really is. Without this the list would be measured from the shop or the pin, which is
    // why results could be far from them. Asks for permission only when asked (tapping the search box).
    const findMe = async (ask = false) => {
        try {
            let perm = await Location.getForegroundPermissionsAsync();
            if (perm.status !== 'granted') {
                if (!ask || !perm.canAskAgain) return null;
                perm = await Location.requestForegroundPermissionsAsync();
                if (perm.status !== 'granted') return null;
            }
            setGranted(true);
            let pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
            if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setMe(c);
            return c;
        } catch (e) { return null; }
    };

    // the moment the picker opens, if the permission is already there, learn the position
    useEffect(() => {
        if (visible) findMe(false);
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        readCache('recentPlaces').then((v) => { if (Array.isArray(v)) setRecents(v.slice(0, 6)); });
        if (user && !forShop) fetchAddresses().then((r) => setSaved((r.items || []).filter((a) => a.latitude != null))).catch(() => setSaved([]));
        else setSaved([]);
    }, [visible, user?.id || user?._id || null]);

    const term = q.trim();
    useEffect(() => {
        if (!visible) return undefined;
        if (term.length < 2) { askId.current += 1; setResults(null); setSuggesting(false); return undefined; }
        setSuggesting(true);
        const id = ++askId.current;
        const t = setTimeout(async () => {
            try {
                const r = await suggestPlaces({ q: term, lat: measureFrom.latitude, lng: measureFrom.longitude });
                if (id === askId.current) setResults((r.items || []).map((x) => (forShop ? { ...x, deliverable: null } : x)));
            } catch (e) {
                // server unreachable: fall back to the phone's own geocoder so searching still works
                try {
                    const g = await Location.geocodeAsync(term);
                    if (id === askId.current) {
                        setResults(g.slice(0, 3).map((x) => ({
                            title: term, subtitle: tr('Found on the map'), latitude: x.latitude, longitude: x.longitude,
                            distanceKm: Math.round(kmBetween(measureFrom, x) * 10) / 10, deliverable: null,
                        })));
                    }
                } catch (e2) { if (id === askId.current) setResults([]); }
            } finally { if (id === askId.current) setSuggesting(false); }
        }, 280);
        return () => clearTimeout(t);
    }, [term, visible, me?.latitude, me?.longitude]);   // asked again when the position becomes known

    const remember = (c) => {
        const item = { title: c.title, subtitle: c.subtitle || '', latitude: c.latitude, longitude: c.longitude };
        const next = [item, ...recents.filter((x) => !(x.title === item.title && x.subtitle === item.subtitle))].slice(0, 6);
        setRecents(next);
        writeCache('recentPlaces', next);
    };

    const go = (c, { save = true } = {}) => {
        Keyboard.dismiss();
        setFocused(false);
        setQ(c.title || '');
        if (save && c.title) remember(c);
        const pt = { latitude: c.latitude, longitude: c.longitude };
        setCenter(pt);
        goTo(pt, 0.003);
    };

    const choose = async (c) => {
        if (c.latitude != null && c.longitude != null) { go(c); return; }
        // a suggestion that came with a name only: look up where it is
        setSearching(true);
        try {
            const r = await placeById(c.placeId);
            go({ ...c, latitude: r.place.latitude, longitude: r.place.longitude });
        } catch (e) { showToast(tr('Could not open this place. Try another.')); } finally { setSearching(false); }
    };

    const search = async () => {
        if (term.length < 3 && !results?.length) { showToast(tr('Type at least 3 letters')); return; }
        if (results?.length) { choose(results[0]); return; }   // Enter = the best (nearest) match
        Keyboard.dismiss();
        setSearching(true);
        try {
            const r = await suggestPlaces({ q: term, lat: measureFrom.latitude, lng: measureFrom.longitude });
            if (!r.items?.length) { showToast(tr('Place not found. Try adding the city name.')); return; }
            await choose(r.items[0]);
        } catch (e) {
            showToast(tr('Search failed. Check your internet and try again.'));
        } finally { setSearching(false); }
    };

    // what the dropdown lists when the box is empty: closest first
    const nearest = (list) => list
        .map((x) => ({ ...x, distanceKm: Math.round(kmBetween(measureFrom, x) * 10) / 10 }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    const savedRows = nearest(saved.map((a) => ({
        key: `s${a._id}`, kind: 'saved', title: a.label || 'Saved address',
        subtitle: [a.line1, a.city].filter(Boolean).join(', '), latitude: a.latitude, longitude: a.longitude,
    }))).slice(0, 4);
    const recentRows = nearest(recents.map((r, i) => ({ ...r, key: `r${i}`, kind: 'recent' }))).slice(0, 5);
    const showPanel = focused && (term.length >= 2 ? (suggesting || results !== null) : (savedRows.length || recentRows.length));

    const canConfirm = !resolving;

    // ---------------- the desktop website: a centred card, search + the chosen place on the left, the map on the right ----------------
    if (desk) {
        const cardW = Math.min(1080, winW - 64);
        const cardH = Math.min(680, winH - 64);
        const hasList = (term.length >= 2) || savedRows.length > 0 || recentRows.length > 0;
        return (
            <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setShown(true)} onDismiss={() => setShown(false)}>
                <View style={s.dBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <View style={[s.dCard, { width: cardW, height: cardH, backgroundColor: surface, borderColor: border }]}>
                        {/* left: search, suggestions, the chosen place */}
                        <View style={[s.dLeft, { borderRightColor: border }]}>
                            <View style={s.dHead}>
                                <Text style={[s.dTitle, { color: text }]}>{tr('Pin your location')}</Text>
                                <Text style={[s.dSub, { color: muted }]}>{tr('Search, or move the map to place the pin')}</Text>
                            </View>
                            <View style={[s.dSearch, { backgroundColor: background, borderColor: focused ? primary : border }]}>
                                <Ionicons name="search" size={18} color={primary} />
                                <TextInput
                                    value={q} onChangeText={setQ} onSubmitEditing={search}
                                    onFocus={() => { setFocused(true); if (!me) findMe(true); }} onBlur={() => setFocused(false)}
                                    placeholder={tr('Search area, landmark or street')} placeholderTextColor={muted}
                                    returnKeyType="search" style={[s.dInput, { color: text, outlineStyle: 'none', outlineWidth: 0 }]}
                                />
                                {searching ? <ActivityIndicator size="small" color={primary} /> : q ? (
                                    <Pressable onPress={() => setQ('')} hitSlop={10} style={{ cursor: 'pointer' }}>
                                        <Ionicons name="close-circle" size={18} color={muted} />
                                    </Pressable>
                                ) : null}
                            </View>
                            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                                {term.length >= 2 ? (
                                    <>
                                        {suggesting && !(results && results.length) ? <View style={s.rowPad}><LineShimmer width={240} height={16} /></View> : null}
                                        {results && !results.length && !suggesting ? <Text style={[s.empty, { color: muted }]}>{tr('No match. Try the area or city name too.')}</Text> : null}
                                        {(results || []).map((c, i) => <PlaceRow key={`${c.placeId || c.title}-${i}`} c={{ ...c, kind: 'place' }} onPress={() => choose(c)} />)}
                                    </>
                                ) : hasList ? (
                                    <>
                                        {savedRows.length ? <Text style={[s.sec, { color: muted }]}>{tr('YOUR SAVED ADDRESSES')}</Text> : null}
                                        {savedRows.map((c) => <PlaceRow key={c.key} c={c} onPress={() => go(c, { save: false })} />)}
                                        {recentRows.length ? <Text style={[s.sec, { color: muted }]}>{tr('RECENT SEARCHES')}</Text> : null}
                                        {recentRows.map((c) => <PlaceRow key={c.key} c={c} onPress={() => go(c, { save: false })} />)}
                                    </>
                                ) : (
                                    <View style={{ alignItems: 'center', paddingTop: 36, paddingHorizontal: 18 }}>
                                        <Ionicons name="map-outline" size={34} color={muted} />
                                        <Text style={[s.empty, { color: muted }]}>{tr('Type an area, landmark or street, or drag the map to put the pin on your door.')}</Text>
                                    </View>
                                )}
                            </ScrollView>
                            <View style={[s.dFoot, { borderTopColor: border }]}>
                                <Text style={[s.dCap, { color: muted }]}>{tr('SELECTED LOCATION')}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, marginBottom: 16, minHeight: 40 }}>
                                    <Ionicons name="location-sharp" size={20} color={primary} style={{ marginTop: 1 }} />
                                    <View style={{ flex: 1, marginLeft: 10 }}>
                                        {resolving ? <View style={{ marginTop: 4 }}><LineShimmer width={220} height={16} /></View> : <Text style={[s.dAddr, { color: text }]} numberOfLines={3}>{label || tr('Pinned location')}</Text>}
                                    </View>
                                </View>
                                <Pressable
                                    onPress={confirm}
                                    disabled={!canConfirm}
                                    style={({ hovered }) => [s.btn, { backgroundColor: primary, borderRadius: radius, opacity: canConfirm ? 1 : 0.5, cursor: canConfirm ? 'pointer' : 'default', transitionProperty: 'filter, box-shadow', transitionDuration: '180ms' }, hovered && canConfirm && { filter: 'brightness(1.12)', boxShadow: `0 10px 28px ${primary}55` }]}
                                >
                                    <Text numberOfLines={1} style={[s.btnTxt, { color: onPrimary }]}>{tr('Confirm location')}</Text>
                                </Pressable>
                            </View>
                        </View>

                        {/* right: the map */}
                        <View style={{ flex: 1 }}>
                            {shown ? (
                                <MapView
                                    ref={map}
                                    style={StyleSheet.absoluteFill}
                                    initialRegion={{ ...start, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                                    onMapReady={() => setReady(true)}
                                    onRegionChangeComplete={(r) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
                                    showsUserLocation={granted} showsMyLocationButton={false} toolbarEnabled={false}
                                    loadingEnabled loadingIndicatorColor={primary} loadingBackgroundColor={surface}
                                />
                            ) : (
                                <View style={[StyleSheet.absoluteFill, s.loading]}><LineShimmer width={260} height={260} /></View>
                            )}
                            <View pointerEvents="none" style={s.pinWrap}>
                                <Ionicons name="location-sharp" size={44} color={primary} />
                            </View>
                            <View pointerEvents="none" style={s.dHint}>
                                <View style={[s.dHintPill, { backgroundColor: surface, borderColor: border }]}>
                                    <Ionicons name="move-outline" size={14} color={primary} />
                                    <Text style={[s.dHintTxt, { color: text }]}>{tr('Move the map to place the pin')}</Text>
                                </View>
                            </View>
                            <Pressable onPress={onClose} accessibilityLabel={tr('Close')} style={({ hovered }) => [s.dClose, { backgroundColor: surface, borderColor: border, cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms' }, hovered && { backgroundColor: border }]}>
                                <Ionicons name="close" size={20} color={text} />
                            </Pressable>
                            <Pressable onPress={locate} disabled={locating} accessibilityLabel={tr('Use my current location')} style={({ hovered }) => [s.dGps, { backgroundColor: surface, borderColor: border, cursor: 'pointer', transitionProperty: 'background-color, transform', transitionDuration: '150ms' }, hovered && { backgroundColor: border, transform: [{ scale: 1.06 }] }]}>
                                {locating ? <Skel width={24} height={24} radius={12} /> : <Ionicons name="locate" size={24} color={primary} />}
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        );
    }

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
                        <LineShimmer width={260} height={260} />
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
                        onFocus={() => { setFocused(true); if (!me) findMe(true); }} onBlur={() => setTimeout(() => setFocused(false), 150)}
                        placeholder={tr('Search area, landmark or street')} placeholderTextColor={muted}
                        returnKeyType="search" style={[s.searchInput, { color: text }]}
                    />
                    {searching ? <ActivityIndicator size="small" color={primary} /> : q ? (
                        <Pressable onPress={() => setQ('')} hitSlop={10}>
                            <Ionicons name="close-circle" size={18} color={muted} />
                        </Pressable>
                    ) : null}
                </View>

                {showPanel ? (
                    <View style={[s.panel, { top: insets.top + 58, backgroundColor: surface, borderColor: border, maxHeight: Math.round(winH * 0.5) }]}>
                        <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
                            {term.length >= 2 ? (
                                <>
                                    {suggesting && !(results && results.length) ? (
                                        <View style={s.rowPad}><LineShimmer width={240} height={16} /></View>
                                    ) : null}
                                    {results && !results.length && !suggesting ? (
                                        <Text style={[s.empty, { color: muted }]}>{tr('No match. Try the area or city name too.')}</Text>
                                    ) : null}
                                    {(results || []).map((c, i) => (
                                        <PlaceRow key={`${c.placeId || c.title}-${i}`} c={{ ...c, kind: 'place' }} onPress={() => choose(c)} />
                                    ))}
                                </>
                            ) : (
                                <>
                                    {savedRows.length ? <Text style={[s.sec, { color: muted }]}>{tr('YOUR SAVED ADDRESSES')}</Text> : null}
                                    {savedRows.map((c) => <PlaceRow key={c.key} c={c} onPress={() => go(c, { save: false })} />)}
                                    {recentRows.length ? <Text style={[s.sec, { color: muted }]}>{tr('RECENT SEARCHES')}</Text> : null}
                                    {recentRows.map((c) => <PlaceRow key={c.key} c={c} onPress={() => go(c, { save: false })} />)}
                                </>
                            )}
                        </ScrollView>
                    </View>
                ) : null}

                <Pressable onPress={locate} disabled={locating} style={[s.gps, { backgroundColor: surface, bottom: 170 + insets.bottom }]}>
                    {locating ? <Skel width={24} height={24} radius={12} /> : <Ionicons name="locate" size={24} color={primary} />}
                </Pressable>

                <View style={[s.bar, { backgroundColor: surface, borderTopColor: border, paddingBottom: (insets.bottom || 0) + 14 }]}>
                    <Text style={[s.hint, { color: muted }]}>{tr('Move the map to place the pin')}</Text>
                    {resolving ? <View style={{ marginVertical: 6 }}><LineShimmer width={220} height={16} /></View> : (
                        <Text style={[s.addr, { color: text }]} numberOfLines={2}>{label || tr('Pinned location')}</Text>
                    )}
                    <Pressable
                        onPress={confirm}
                        disabled={!canConfirm}
                        style={[s.btn, { backgroundColor: primary, borderRadius: radius, opacity: canConfirm ? 1 : 0.5 }]}
                    >
                        <Text numberOfLines={1} style={[s.btnTxt, { color: onPrimary }]}>{tr('Confirm location')}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    // the desktop card
    dBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' },
    dCard: { flexDirection: 'row', borderRadius: 24, borderWidth: 1, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' },
    dLeft: { width: 400, borderRightWidth: 1 },
    dHead: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
    dTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
    dSub: { fontSize: 13, marginTop: 4 },
    dSearch: { marginHorizontal: 24, height: 46, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 6 },
    dInput: { flex: 1, minWidth: 0, height: '100%', marginLeft: 10, fontSize: 14, paddingVertical: 0 },
    dFoot: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 22, borderTopWidth: 1 },
    dCap: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
    dAddr: { fontSize: 14.5, fontWeight: '700', lineHeight: 20 },
    dClose: { position: 'absolute', top: 16, right: 16, width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' },
    dGps: { position: 'absolute', right: 16, bottom: 20, width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' },
    dHint: { position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center' },
    dHintPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' },
    dHintTxt: { fontSize: 12.5, fontWeight: '700', marginLeft: 7 },
    // same left / right edges as the search box (the back button is 64px in), so it hangs straight below it
    panel: { position: 'absolute', left: 64, right: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, elevation: 8, overflow: 'hidden', zIndex: 5 },
    sec: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    rowTitle: { fontSize: 14, fontWeight: '700' },
    rowSub: { fontSize: 12, marginTop: 2 },
    rowR: { alignItems: 'flex-end', marginLeft: 10, maxWidth: 110 },
    rowKm: { fontSize: 12.5, fontWeight: '800' },
    rowBadge: { fontSize: 10.5, fontWeight: '800', marginTop: 3 },
    rowPad: { padding: 18, alignItems: 'center' },
    empty: { padding: 16, fontSize: 13, textAlign: 'center' },
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