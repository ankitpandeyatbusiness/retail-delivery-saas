// src/components/ui/addresses.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Modal, View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Alert,
    KeyboardAvoidingView, Platform, StyleSheet, Animated, Easing, Switch,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { showToast, tint } from './shop';
import { fetchAddresses, saveAddress, deleteAddress, checkServiceable } from '../../api/shopApi';

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

    // slide in / out
    const [show, setShow] = useState(visible);
    const prog = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (visible) {
            setShow(true);
            Animated.timing(prog, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        } else if (show) {
            Animated.timing(prog, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setShow(false); });
        }
    }, [visible]);

    const openForm = (a) => {
        setEditId(a ? a._id : null);
        setGeo(null);
        setForm(a ? {
            label: a.label || 'Home', name: a.name || '', phone: a.phone || '', line1: a.line1 || '', line2: a.line2 || '',
            landmark: a.landmark || '', city: a.city || '', pincode: a.pincode || '', isDefault: !!a.isDefault,
            lat: Number.isFinite(a.latitude) ? a.latitude : null, lng: Number.isFinite(a.longitude) ? a.longitude : null,
        } : EMPTY);
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
            setForm((p) => ({ ...p, lat: latitude, lng: longitude }));
            setGeo(await checkServiceable(latitude, longitude));
        } catch (e) {
            showToast('Could not get your location. Ensure GPS is turned on.');
        } finally { setLocating(false); }
    };

    const save = async () => {
        const msg = !form.line1.trim() ? 'Enter the address line'
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

    const remove = () => Alert.alert('Delete address?', 'This cannot be undone.', [
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

    return (
        <Modal visible={show} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={s.backdropWrap}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                <Pressable style={{ flex: 1 }} onPress={onClose} />
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <Animated.View style={[s.sheet, { backgroundColor: background, transform: [{ translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }]}>
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
                                    <GpsCard locating={locating} geo={geo} hasPin={form.lat !== null} onPress={here} />

                                    <Text style={[s.sec, { color: muted }]}>SAVE AS</Text>
                                    <View style={s.pills}>
                                        {['Home', 'Work', 'Other'].map((l) => <Pill key={l} label={l} on={form.label === l} onPress={() => set('label', l)} />)}
                                    </View>

                                    <Text style={[s.sec, { color: muted }]}>ADDRESS DETAILS</Text>
                                    {FIELDS.map(([k, ph, kb, max]) => (
                                        <Field key={k} label={ph} value={form[k]} onChangeText={(v) => set(k, v)} keyboardType={kb} maxLength={max} />
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
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    backdropWrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, maxHeight: '90%' },
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
    save: { marginTop: 20, paddingVertical: 16, alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
    saveTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
});