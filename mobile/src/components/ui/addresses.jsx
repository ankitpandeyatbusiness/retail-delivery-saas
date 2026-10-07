// src/ui/addresses.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    Modal, View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Alert,
    KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import * as Location from 'expo-location';
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

function Pill({ on, label, onPress }) {
    const { primary, text } = useBrand();
    return (
        <Pressable onPress={onPress} style={[s.pill, on && { backgroundColor: tint(primary), borderColor: primary }]}>
            <Text style={[s.pillTxt, { color: on ? primary : text }]}>{label}</Text>
        </Pressable>
    );
}

// selectedId + onSelect: pick an address (cart). manage: edit only (account).
export function AddressSheet({ visible, onClose, selectedId, onSelect, onChanged, manage }) {
    const { primary, radius, text, error } = useBrand();
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState('list');
    const [form, setForm] = useState(EMPTY);
    const [editId, setEditId] = useState(null);
    const [geo, setGeo] = useState(null);
    const [saving, setSaving] = useState(false);
    const [locating, setLocating] = useState(false);

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
            const perm = await Location.requestForegroundPermissionsAsync();
            if (perm.status !== 'granted') { showToast('Location permission denied'); return; }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const { latitude, longitude } = pos.coords;
            setForm((p) => ({ ...p, lat: latitude, lng: longitude }));
            setGeo(await checkServiceable(latitude, longitude));
        } catch (e) {
            showToast('Could not get your location');
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

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
                <View style={s.sheet}>
                    <View style={s.top}>
                        <Text style={[s.title, { color: text }]}>
                            {mode === 'form' ? (editId ? 'Edit address' : 'New address') : (manage ? 'Saved addresses' : 'Choose address')}
                        </Text>
                        <Pressable onPress={mode === 'form' && list.length ? () => setMode('list') : onClose} hitSlop={10}>
                            <Text style={[s.link, { color: primary }]}>{mode === 'form' && list.length ? 'Back' : 'Close'}</Text>
                        </Pressable>
                    </View>

                    {loading && !list.length ? <ActivityIndicator style={{ margin: 30 }} color={primary} /> : null}

                    {mode === 'list' ? (
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {list.map((a) => (
                                <Pressable
                                    key={a._id}
                                    onPress={() => (manage ? openForm(a) : (onSelect(a), onClose()))}
                                    style={s.row}
                                >
                                    {!manage ? (
                                        <View style={[s.radio, { borderColor: selectedId === a._id ? primary : '#BBBBBB' }]}>
                                            {selectedId === a._id ? <View style={[s.radioDot, { backgroundColor: primary }]} /> : null}
                                        </View>
                                    ) : null}
                                    <View style={{ flex: 1, marginLeft: manage ? 0 : 10 }}>
                                        <Text style={[s.rowTitle, { color: text }]}>
                                            {a.label}{a.isDefault ? '  · Default' : ''}
                                        </Text>
                                        {a.name || a.phone ? <Text style={s.rowSub}>{[a.name, a.phone].filter(Boolean).join(' · ')}</Text> : null}
                                        <Text style={s.rowSub}>{addrLine(a)}</Text>
                                    </View>
                                    {!manage ? (
                                        <Pressable onPress={() => openForm(a)} hitSlop={8}>
                                            <Text style={[s.link, { color: primary }]}>Edit</Text>
                                        </Pressable>
                                    ) : <Text style={s.chev}>›</Text>}
                                </Pressable>
                            ))}
                            <Pressable onPress={() => openForm(null)} style={[s.btn, { borderColor: primary, borderRadius: radius }]}>
                                <Text style={[s.btnGhostTxt, { color: primary }]}>+ Add new address</Text>
                            </Pressable>
                        </ScrollView>
                    ) : (
                        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                            <Pressable onPress={here} disabled={locating} style={[s.btn, { borderColor: primary, borderRadius: radius, marginTop: 4 }]}>
                                {locating ? <ActivityIndicator color={primary} />
                                    : <Text style={[s.btnGhostTxt, { color: primary }]}>📍 Use my current location</Text>}
                            </Pressable>
                            {geo ? (
                                <Text style={[s.geo, { color: geo.serviceable ? '#1E8E3E' : error }]}>
                                    {geo.serviceable
                                        ? `Location saved${geo.distanceKm != null ? ` · ${geo.distanceKm} km away` : ''}`
                                        : geo.message}
                                </Text>
                            ) : (form.lat !== null ? <Text style={[s.geo, { color: '#777777' }]}>Location saved</Text> : null)}

                            <View style={s.pills}>
                                {['Home', 'Work', 'Other'].map((l) => <Pill key={l} label={l} on={form.label === l} onPress={() => set('label', l)} />)}
                            </View>
                            {FIELDS.map(([k, ph, kb, max]) => (
                                <TextInput
                                    key={k} value={form[k]} onChangeText={(v) => set(k, v)} placeholder={ph}
                                    placeholderTextColor="#999999" keyboardType={kb} maxLength={max} style={s.input}
                                />
                            ))}
                            <Pressable onPress={() => set('isDefault', !form.isDefault)} style={s.defRow}>
                                <View style={[s.check, form.isDefault ? { backgroundColor: primary, borderColor: primary } : { borderColor: '#BBBBBB' }]}>
                                    {form.isDefault ? <Text style={s.tick}>✓</Text> : null}
                                </View>
                                <Text style={[s.rowSub, { marginLeft: 10, color: text }]}>Make this my default address</Text>
                            </Pressable>
                            <Pressable onPress={save} disabled={saving} style={[s.save, { backgroundColor: primary, borderRadius: radius }]}>
                                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveTxt}>Save address</Text>}
                            </Pressable>
                            {editId ? (
                                <Pressable onPress={remove} style={{ alignItems: 'center', padding: 14 }}>
                                    <Text style={{ color: error, fontWeight: '700' }}>Delete address</Text>
                                </Pressable>
                            ) : null}
                        </ScrollView>
                    )}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const s = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: '88%' },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { fontSize: 18, fontWeight: '800' },
    link: { fontSize: 13, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
    rowTitle: { fontSize: 14, fontWeight: '800' },
    rowSub: { fontSize: 12, color: '#666666', marginTop: 2 },
    chev: { fontSize: 22, color: '#999999' },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    btn: { marginTop: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
    btnGhostTxt: { fontSize: 14, fontWeight: '800' },
    geo: { fontSize: 12, fontWeight: '600', marginTop: 8 },
    pills: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
    pill: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 18, marginRight: 8 },
    pillTxt: { fontSize: 12, fontWeight: '600' },
    input: { marginTop: 10, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 10, padding: 11, fontSize: 14, color: '#1C1C1C' },
    defRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    tick: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', lineHeight: 15 },
    save: { marginTop: 16, paddingVertical: 13, alignItems: 'center' },
    saveTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});