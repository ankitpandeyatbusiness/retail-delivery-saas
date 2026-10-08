// src/components/ui/addresses.jsx
// Address sheet in ONE file. Drawn by SheetHost (see SheetPortal.jsx) in the app's own window,
// so it reaches the true bottom of the screen, over the tab bar.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Keyboard, Platform,
    StyleSheet, Animated, Easing, Switch, BackHandler, useWindowDimensions
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetPortal } from './SheetPortal';
import { themedAlert } from './dialog';
import { useBrand } from './kit';
import { showToast, tint } from './shop';
import { fetchAddresses, saveAddress, deleteAddress, checkServiceable } from '../../api/shopApi';
import MapPicker from './MapPicker';
import { useAuthStore } from '../../store/useAuthStore';

export const addrLine = (a) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');
const errMsg = (e) => e?.response?.data?.error || 'Something went wrong. Try again.';

const EMPTY = { label: 'Home', name: '', phone: '', line1: '', line2: '', landmark: '', city: '', pincode: '', isDefault: false, lat: null, lng: null };
const FIELDS = [
    ['name', 'Receiver name', 'default', 80],
    ['phone', 'Phone (10 digits)', 'number-pad', 10],
    ['line1', 'Flat, building, street *', 'default', 150],
    ['line2', 'Area (optional)', 'default', 150],
    ['landmark', 'Landmark (optional)', 'default', 100],
    ['city', 'City', 'default', 60],
    ['pincode', 'Pincode', 'number-pad', 6],
];
const ICON = { Home: 'home-outline', Work: 'briefcase-outline', Other: 'location-outline' };

// ---------- small animated helpers ----------
function Press({ onPress, style, children, disabled, hitSlop }) {
    const v = useRef(new Animated.Value(1)).current;
    const to = (x) => Animated.spring(v, { toValue: x, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable onPress={onPress} disabled={disabled} hitSlop={hitSlop} onPressIn={() => to(0.97)} onPressOut={() => to(1)}>
            <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

function Appear({ children, delay = 0, style }) {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(v, { toValue: 1, duration: 300, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, []);
    return (
        <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
            {children}
        </Animated.View>
    );
}

function Pill({ on, label, onPress }) {
    const { primary, text, surface, border } = useBrand();
    return (
        <Press onPress={onPress} style={[s.pill, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }]}>
            <Ionicons name={ICON[label]} size={14} color={on ? primary : text} style={{ marginRight: 6 }} />
            <Text style={[s.pillTxt, { color: on ? primary : text }]}>{label}</Text>
        </Press>
    );
}

function Field({ label, value, onChangeText, keyboardType, maxLength }) {
    const { text, muted, border, surface, primary } = useBrand();
    const f = useRef(new Animated.Value(0)).current;
    const go = (x) => Animated.timing(f, { toValue: x, duration: 180, useNativeDriver: false }).start();
    return (
        <Animated.View style={[s.field, { backgroundColor: surface, borderColor: f.interpolate({ inputRange: [0, 1], outputRange: [border, primary] }) }]}>
            <Text style={[s.fLabel, { color: muted }]}>{label}</Text>
            <TextInput
                value={value} onChangeText={onChangeText} keyboardType={keyboardType} maxLength={maxLength}
                onFocus={() => go(1)} onBlur={() => go(0)} placeholderTextColor={muted}
                style={[s.fInput, { color: text }]}
            />
        </Animated.View>
    );
}

// GPS box: idle -> pulsing while locating -> green/red result
function GpsCard({ locating, geo, hasPin, onPress }) {
    const { primary, radius, text, muted, error } = useBrand();
    const pulse = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!locating) { pulse.setValue(0); return undefined; }
        const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [locating]);

    const bad = geo && !geo.serviceable;
    const good = (geo && geo.serviceable) || (!geo && hasPin);
    const accent = bad ? error : good ? '#1E8E3E' : primary;
    const title = locating ? 'Finding your location...' : good ? 'Location captured' : bad ? 'Outside delivery area' : 'Use my current location';
    const sub = locating ? 'Keep GPS on for best accuracy'
        : bad ? geo.message
            : good ? (geo?.distanceKm != null ? `${geo.distanceKm} km from the shop · tap to refresh` : 'Tap to refresh')
                : 'Fastest way to set a precise delivery spot';

    return (
        <Press onPress={onPress} disabled={locating} style={[s.gps, { borderColor: accent, backgroundColor: tint(accent), borderRadius: radius }]}>
            <View style={s.gpsIconWrap}>
                {locating ? (
                    <Animated.View style={[s.ring, { borderColor: accent, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }] }]} />
                ) : null}
                <View style={[s.gpsIcon, { backgroundColor: accent }]}>
                    <Ionicons name={bad ? 'alert' : good ? 'checkmark' : 'locate'} size={20} color="#FFFFFF" />
                </View>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[s.gpsTitle, { color: text }]}>{title}</Text>
                <Text style={[s.gpsSub, { color: bad ? error : muted }]}>{sub}</Text>
            </View>
            {locating ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="refresh-outline" size={18} color={accent} />}
        </Press>
    );
}

// selectedId + onSelect: pick an address (cart). manage: edit only (account).
export function AddressSheet({ visible, onClose, selectedId, onSelect, onChanged, manage }) {
    const { primary, radius, text, error, background, surface, border, muted } = useBrand();
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState('list');
    const [form, setForm] = useState(EMPTY);
    const [editId, setEditId] = useState(null);
    const [geo, setGeo] = useState(null);
    const [saving, setSaving] = useState(false);
    const [locating, setLocating] = useState(false);
    const { height: H } = useWindowDimensions();
    const [mapOpen, setMapOpen] = useState(false);
    const insets = useSafeAreaInsets();
    const autoFilled = useRef({ line1: '', line2: '' });
    // slide in / out; `show` stays true until the close animation ends
    const [show, setShow] = useState(visible);
    const prog = useRef(new Animated.Value(0)).current;
    const user = useAuthStore((st) => st.user);
    // load() is memoized with [], so it would see a stale user. Read through a ref instead.
    const userRef = useRef(user);
    userRef.current = user;
    const [forOther, setForOther] = useState(false);

    const toggleOther = (v) => {
        setForOther(v);
        const prof = profileDefaults();
        setForm((p) => ({
            ...p,
            name: v ? '' : prof.name,
            phone: v ? '' : prof.phone,
            lat: v ? null : p.lat, lng: v ? null : p.lng,
        }));
        setGeo(null);
    };

    const profileDefaults = () => ({
        name: (userRef.current?.name || '').trim(),
        phone: String(userRef.current?.phone || '').replace(/\D/g, '').slice(-10),
    });
    useEffect(() => {
        if (visible) {
            setShow(true);
            Animated.timing(prog, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        } else if (show) {
            Animated.timing(prog, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true })
                .start(({ finished }) => { if (finished) setShow(false); });
        }
    }, [visible]);

    // phone back button closes the sheet
    useEffect(() => {
        if (!visible) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
        return () => sub.remove();
    }, [visible, onClose]);

    const openForm = (a) => {
        const prof = profileDefaults();
        setForOther(!!(a && a.phone && a.phone !== prof.phone));
        setEditId(a ? a._id : null);
        setGeo(null);
        setForm(a ? {
            label: a.label || 'Home',
            name: a.name || prof.name,          // blank on an old address -> use profile
            phone: a.phone || prof.phone,
            line1: a.line1 || '', line2: a.line2 || '',
            landmark: a.landmark || '', city: a.city || '', pincode: a.pincode || '',
            isDefault: !!a.isDefault,
            lat: Number.isFinite(a.latitude) ? a.latitude : null,
            lng: Number.isFinite(a.longitude) ? a.longitude : null,
        } : { ...EMPTY, ...prof });
        setMode('form');
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const items = (await fetchAddresses()).items || [];
            setList(items);
            if (onChanged) onChanged(items);
            if (!items.length) openForm(null); else setMode('list');
            return items;
        } catch (e) {
            showToast(errMsg(e));
            return [];
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { if (visible) { setMode('list'); load(); } }, [visible]);

    const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

    const here = async () => {
        setLocating(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                showToast('Location permission denied. Please enable it in Settings.');
                return;
            }
            // Highest accuracy = real GPS. Balanced can be off by 100m+ (WiFi/cell towers).
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
            const { latitude, longitude } = pos.coords;
            const res = await checkServiceable(latitude, longitude);
            setGeo(res);
            if (res.serviceable) setForm((p) => ({ ...p, lat: latitude, lng: longitude }));
            else setForm((p) => ({ ...p, lat: null, lng: null }));   // never save a far-away pin
        } catch (e) {
            showToast('Could not get your location. Ensure GPS is turned on.');
        } finally { setLocating(false); }
    };

    const onPinned = async (p) => {
        setMapOpen(false);
        setForm((f) => ({
            ...f,
            lat: p.latitude,
            lng: p.longitude,
            line1: p.line1 || f.line1,       // always replaced by the pinned address
            line2: p.area || f.line2,
            city: p.city || f.city,
            pincode: p.pincode || f.pincode,
        }));
        try { setGeo(await checkServiceable(p.latitude, p.longitude)); } catch (e) { setGeo(null); }
    };
    const save = async () => {
        if (geo && !geo.serviceable) {
            showToast('This spot is outside our delivery area. Pin the receiver’s location on the map.');
            return;
        }
        const msg = !form.line1.trim() ? 'Enter the address line'
            : forOther && !form.name.trim() ? 'Enter the receiver’s name'
                : forOther && !/^[6-9]\d{9}$/.test(form.phone) ? 'Enter the receiver’s 10-digit phone so the rider can call them'
                    : form.phone && !/^[6-9]\d{9}$/.test(form.phone) ? 'Enter a valid 10-digit phone'
                        : form.pincode && !/^\d{6}$/.test(form.pincode) ? 'Enter a valid 6-digit pincode' : '';
        if (msg) { showToast(msg); return; }

        const body = { label: form.label, isDefault: form.isDefault };
        FIELDS.forEach(([k]) => { body[k] = form[k].trim(); });
        if (form.lat !== null && form.lng !== null) { body.latitude = form.lat; body.longitude = form.lng; }

        setSaving(true);
        try {
            const doc = await saveAddress(body, editId);
            const items = await load();
            if (!manage && !editId && onSelect) { onSelect(doc); onClose(); } else if (items.length) setMode('list');
        } catch (e) {
            showToast(errMsg(e));
        } finally { setSaving(false); }
    };
    const [kb, setKb] = useState(0);
    useEffect(() => {
        if (!visible) return undefined;
        const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const a = Keyboard.addListener(showEv, (e) => setKb(e.endCoordinates.height));
        const b = Keyboard.addListener(hideEv, () => setKb(0));
        return () => { a.remove(); b.remove(); setKb(0); };
    }, [visible]);
    const remove = () => themedAlert('Delete address?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
            text: 'Delete', style: 'destructive',
            onPress: async () => {
                try { await deleteAddress(editId); await load(); } catch (e) { showToast(errMsg(e)); }
            },
        },
    ]);

    const inForm = mode === 'form';
    const canBack = inForm && list.length > 0;

    if (!show) return null;

    return (
        <>
            <SheetPortal>
                <View style={s.backdropWrap}>
                    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                    <Pressable style={{ flex: 1 }} onPress={onClose} />
                    <View style={{ paddingBottom: kb }}>
                        <Animated.View style={[s.sheet, {
                            backgroundColor: background,
                            maxHeight: Math.min(H * 0.9, H - kb - insets.top - 12),
                            paddingBottom: kb ? 12 : 18 + insets.bottom,
                            transform: [{ translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [H, 0] }) }],
                        }]}>
                            <View style={[s.handle, { backgroundColor: border }]} />
                            <View style={s.top}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                    {canBack ? (
                                        <Pressable onPress={() => setMode('list')} hitSlop={12} style={[s.roundBtn, { backgroundColor: surface, borderColor: border }]}>
                                            <Ionicons name="chevron-back" size={18} color={text} />
                                        </Pressable>
                                    ) : null}
                                    <Text style={[s.title, { color: text, marginLeft: canBack ? 10 : 0 }]}>
                                        {inForm ? (editId ? 'Edit address' : 'New address') : (manage ? 'Saved addresses' : 'Choose address')}
                                    </Text>
                                </View>
                                <Pressable onPress={onClose} hitSlop={12} style={[s.roundBtn, { backgroundColor: surface, borderColor: border }]}>
                                    <Ionicons name="close" size={18} color={text} />
                                </Pressable>
                            </View>

                            {loading && !list.length ? <ActivityIndicator style={{ margin: 30 }} color={primary} /> : null}

                            {!inForm ? (
                                <Appear key="list" style={{ flexShrink: 1 }}>
                                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
                                        {list.map((a, i) => {
                                            const on = !manage && selectedId === a._id;
                                            return (
                                                <Appear key={a._id} delay={Math.min(i, 6) * 50}>
                                                    <Press
                                                        onPress={() => (manage ? openForm(a) : (onSelect(a), onClose()))}
                                                        style={[s.row, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }]}
                                                    >
                                                        <View style={[s.rowIcon, { backgroundColor: on ? primary : tint(primary) }]}>
                                                            <Ionicons name={ICON[a.label] || 'location-outline'} size={18} color={on ? '#FFFFFF' : primary} />
                                                        </View>
                                                        <View style={{ flex: 1, marginLeft: 12 }}>
                                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                                <Text style={[s.rowTitle, { color: text }]}>{a.label}</Text>
                                                                {a.isDefault ? <View style={[s.badge, { backgroundColor: tint(primary) }]}><Text style={[s.badgeTxt, { color: primary }]}>DEFAULT</Text></View> : null}
                                                            </View>
                                                            {a.name || a.phone ? <Text style={[s.rowSub, { color: muted }]}>{[a.name, a.phone].filter(Boolean).join(' · ')}</Text> : null}
                                                            <Text style={[s.rowSub, { color: muted }]} numberOfLines={2}>{addrLine(a)}</Text>
                                                        </View>
                                                        {!manage ? (
                                                            <Pressable onPress={() => openForm(a)} hitSlop={12} style={{ paddingLeft: 10 }}>
                                                                <Text style={[s.link, { color: primary }]}>Edit</Text>
                                                            </Pressable>
                                                        ) : <Ionicons name="chevron-forward" size={18} color={muted} />}
                                                    </Press>
                                                </Appear>
                                            );
                                        })}
                                        <Press onPress={() => openForm(null)} style={[s.addBtn, { borderColor: primary, borderRadius: radius }]}>
                                            <Ionicons name="add" size={18} color={primary} />
                                            <Text style={[s.addTxt, { color: primary }]}>Add new address</Text>
                                        </Press>
                                    </ScrollView>
                                </Appear>
                            ) : (
                                <Appear key="form" style={{ flexShrink: 1 }}>
                                    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
                                        <View style={[s.defRow, { backgroundColor: surface, borderColor: border, marginBottom: 10 }]}>
                                            <Text style={[s.rowSub, { color: text, flex: 1, marginTop: 0, fontWeight: '700' }]}>Ordering for someone else?</Text>
                                            <Switch value={forOther} onValueChange={toggleOther}
                                                trackColor={{ true: tint(primary), false: border }} thumbColor={forOther ? primary : '#FFFFFF'} />
                                        </View>

                                        {!forOther ? <GpsCard locating={locating} geo={geo} hasPin={form.lat !== null} onPress={here} /> : null}

                                        {geo && !geo.serviceable && !forOther ? (
                                            <Pressable onPress={() => toggleOther(true)} style={{ marginTop: 8 }}>
                                                <Text style={[s.link, { color: primary }]}>Sending to someone nearby? Pin their location instead</Text>
                                            </Pressable>
                                        ) : null}
                                        <Press onPress={() => setMapOpen(true)} style={[s.addBtn, { borderColor: primary, borderRadius: radius, marginTop: 10, paddingVertical: 11 }]}>
                                            <Ionicons name="map-outline" size={17} color={primary} />
                                            <Text style={[s.addTxt, { color: primary }]}>{form.lat !== null ? 'Adjust pin on map' : 'Pin location on map'}</Text>
                                        </Press>
                                        {forOther && geo ? (
                                            <Text style={[s.rowSub, { color: geo.serviceable ? '#1E8E3E' : error, marginTop: 8 }]}>
                                                {geo.serviceable
                                                    ? `Within delivery area${geo.distanceKm != null ? ` · ${geo.distanceKm} km from the shop` : ''}`
                                                    : geo.message}
                                            </Text>
                                        ) : null}
                                        <Text style={[s.sec, { color: muted }]}>SAVE AS</Text>
                                        <View style={s.pills}>
                                            {['Home', 'Work', 'Other'].map((l) => <Pill key={l} label={l} on={form.label === l} onPress={() => set('label', l)} />)}
                                        </View>

                                        <Text style={[s.sec, { color: muted }]}>ADDRESS DETAILS</Text>
                                        {FIELDS.map(([k, ph, kb, max]) => (
                                            <Field key={k} label={forOther && k === 'name' ? 'Receiver name' : forOther && k === 'phone' ? 'Receiver phone (rider will call this)' : ph} value={form[k]} onChangeText={(v) => set(k, v)} keyboardType={kb} maxLength={max} />
                                        ))}

                                        <View style={[s.defRow, { backgroundColor: surface, borderColor: border }]}>
                                            <Text style={[s.rowSub, { color: text, flex: 1, marginTop: 0, fontWeight: '700' }]}>Make this my default address</Text>
                                            <Switch value={form.isDefault} onValueChange={(v) => set('isDefault', v)} trackColor={{ true: tint(primary), false: border }} thumbColor={form.isDefault ? primary : '#FFFFFF'} />
                                        </View>

                                        <Press onPress={save} disabled={saving} style={[s.save, { backgroundColor: primary, borderRadius: radius }]}>
                                            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveTxt}>Save address</Text>}
                                        </Press>
                                        {editId ? (
                                            <Pressable onPress={remove} style={{ alignItems: 'center', padding: 14 }}>
                                                <Text style={{ color: error, fontWeight: '700' }}>Delete address</Text>
                                            </Pressable>
                                        ) : null}
                                    </ScrollView>
                                </Appear>
                            )}
                        </Animated.View>
                    </View>
                </View>
            </SheetPortal>

            <MapPicker
                visible={mapOpen}
                initial={form.lat !== null ? { latitude: form.lat, longitude: form.lng } : null}
                onClose={() => setMapOpen(false)}
                onPick={onPinned}
                startAtShop={forOther}
            />
        </>
    );
}

const s = StyleSheet.create({
    backdropWrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10 },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    title: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
    roundBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    link: { fontSize: 13, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1.5, borderRadius: 16, marginBottom: 10 },
    rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontSize: 14, fontWeight: '800' },
    rowSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
    badge: { marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    badgeTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
    addBtn: { marginTop: 4, borderWidth: 1.5, borderStyle: 'dashed', paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    addTxt: { fontSize: 14, fontWeight: '800', marginLeft: 6 },
    gps: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, padding: 14 },
    gpsIconWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    ring: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
    gpsIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    gpsTitle: { fontSize: 14, fontWeight: '800' },
    gpsSub: { fontSize: 12, marginTop: 3, lineHeight: 16 },
    sec: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginTop: 20, marginBottom: 10 },
    pills: { flexDirection: 'row' },
    pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1.5, borderRadius: 20, marginRight: 8 },
    pillTxt: { fontSize: 12, fontWeight: '800' },
    field: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, marginBottom: 10 },
    fLabel: { fontSize: 11, fontWeight: '700' },
    fInput: { fontSize: 15, fontWeight: '700', paddingVertical: 6 },
    defRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
    save: { marginTop: 20, paddingVertical: 16, alignItems: 'center' },
    saveTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
});