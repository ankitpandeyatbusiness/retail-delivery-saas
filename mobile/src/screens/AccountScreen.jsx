// src/screens/AccountScreen.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator, Alert,
    KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, GuestGate } from '../ui/kit';
import { showToast } from '../ui/shop';
import { AddressSheet } from '../ui/addresses';
import { useAuthStore } from '../store/useAuthStore';
import { useHomeStore } from '../store/useHomeStore';
import { useThemeStore } from '../store/useThemeStore';
import { useFavStore } from '../store/shopStores';
import { fetchMe, updateMe, deleteMe } from '../api/shopApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function EditDialog({ visible, me, onClose, onSaved }) {
    const { primary, radius, text } = useBrand();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (visible) { setName(me?.name || ''); setEmail(me?.email || ''); }
    }, [visible]);

    const save = async () => {
        const n = name.trim();
        const e = email.trim();
        if (n.length < 2 || n.length > 80) { showToast('Name must be 2 to 80 characters'); return; }
        if (e && !EMAIL_RE.test(e)) { showToast('Enter a valid email address'); return; }
        setSaving(true);
        try {
            const u = await updateMe({ name: n, email: e });   // empty email removes it
            onSaved(u);
            onClose();
            showToast('Profile updated');
        } catch (err) {
            showToast(err?.response?.data?.error || 'Could not save. Try again.');
        } finally { setSaving(false); }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={s.dialog}>
                    <Text style={[s.dTitle, { color: text }]}>Edit profile</Text>
                    <Text style={s.label}>Name</Text>
                    <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Your name" placeholderTextColor="#999999" style={s.input} />
                    <Text style={s.label}>Email (optional)</Text>
                    <TextInput
                        value={email} onChangeText={setEmail} maxLength={120} placeholder="you@example.com" placeholderTextColor="#999999"
                        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={s.input}
                    />
                    <Text style={s.label}>Phone</Text>
                    <TextInput value={me?.phone ? `+91 ${me.phone}` : ''} editable={false} style={[s.input, s.locked]} />
                    <Text style={s.note}>Your phone number is your login, so it cannot be changed.</Text>
                    <View style={s.btns}>
                        <Pressable onPress={onClose} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: primary }]}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={save} disabled={saving} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.solidTxt}>Save</Text>}
                        </Pressable>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function AccountInner() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, radius, text, error, background } = useBrand();
    const user = useAuthStore((st) => st.user);
    const favOn = useHomeStore((st) => st.full.features.favourites);
    const shop = useThemeStore((st) => st.theme.name);
    const [me, setMe] = useState(null);
    const [edit, setEdit] = useState(false);
    const [addrSheet, setAddrSheet] = useState(false);
    const [busy, setBusy] = useState(false);

    useFocusEffect(useCallback(() => {
        let on = true;
        fetchMe().then((u) => { if (on) setMe(u); }).catch(() => { });
        return () => { on = false; };
    }, []));

    const p = me || user || {};
    const name = p.name || '';
    const phone = p.phone ? (/^\d{10}$/.test(String(p.phone)) ? `+91 ${p.phone}` : String(p.phone)) : '';
    const initial = (name[0] || String(p.phone || '?')[0] || '?').toUpperCase();

    const saved = (u) => {
        setMe(u);
        useAuthStore.setState((st) => (st.user ? { user: { ...st.user, name: u.name, email: u.email } } : {}));
    };

    const signOut = async () => {
        try { await useAuthStore.getState().logout(); } catch (e) { /* the navigator resets to Login */ }
        useFavStore.getState().reset();
    };

    const doLogout = () => Alert.alert('Log out?', 'You will need to log in again to order.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', onPress: signOut },
    ]);

    const doDelete = () => Alert.alert(
        'Delete your account?',
        'Your profile, saved addresses and favourites will be removed. Past orders stay with the shop. This cannot be undone.',
        [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    try {
                        await deleteMe();
                        showToast('Account deleted');
                        await signOut();
                    } catch (e) {
                        const m = e?.response?.data?.error;
                        if (m) Alert.alert('Cannot delete account', m); else showToast('Network problem. Try again.');
                    } finally { setBusy(false); }
                },
            },
        ],
    );

    const soon = () => showToast('Coming soon');
    const rows = [
        ['Saved addresses', () => setAddrSheet(true)],
        favOn ? ['Favourites', () => nav.navigate('Favourites')] : null,
        ['Payment methods', soon],
        ['Help and support', soon],
        ['Delete account', doDelete, true],
        ['Log out', doLogout],
    ].filter(Boolean);

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                <View style={s.head}>
                    <View style={[s.avatar, { backgroundColor: primary }]}><Text style={s.avatarTxt}>{initial}</Text></View>
                    <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: text }]} numberOfLines={1}>{name || 'Add your name'}</Text>
                        {phone ? <Text style={s.sub}>{phone}</Text> : null}
                        {p.email ? <Text style={s.sub} numberOfLines={1}>{p.email}</Text> : null}
                    </View>
                    <Pressable onPress={() => setEdit(true)} style={[s.ghost, { borderColor: primary, borderRadius: radius, flex: 0, paddingHorizontal: 16 }]}>
                        <Text style={[s.ghostTxt, { color: primary }]}>Edit</Text>
                    </Pressable>
                </View>

                {rows.map(([label, onPress, danger]) => (
                    <Pressable key={label} onPress={onPress} style={s.row}>
                        <Text style={[s.rowTxt, { color: danger ? error : text }]}>{label}</Text>
                        <Text style={s.chev}>›</Text>
                    </Pressable>
                ))}

                <Text style={s.ver}>{shop} · v{Constants.expoConfig?.version || '1.0'}</Text>
            </ScrollView>

            <EditDialog visible={edit} me={p} onClose={() => setEdit(false)} onSaved={saved} />
            <AddressSheet visible={addrSheet} onClose={() => setAddrSheet(false)} manage />
            {busy ? <View style={s.busy}><ActivityIndicator color="#FFFFFF" size="large" /></View> : null}
        </View>
    );
}

export default function AccountScreen() {
    return <GuestGate title="Account"><AccountInner /></GuestGate>;
}

const s = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 22 },
    avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    avatarTxt: { color: '#FFFFFF', fontSize: 26, fontWeight: '800' },
    name: { fontSize: 19, fontWeight: '800' },
    sub: { fontSize: 12, color: '#777777', marginTop: 2 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
    rowTxt: { fontSize: 14, fontWeight: '600' },
    chev: { fontSize: 22, color: '#999999' },
    ver: { textAlign: 'center', fontSize: 11, color: '#777777', marginTop: 26 },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    dialog: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18 },
    dTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
    label: { fontSize: 12, fontWeight: '700', color: '#777777', marginTop: 12, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 10, padding: 11, fontSize: 14, color: '#1C1C1C' },
    locked: { backgroundColor: '#F3F3F3', color: '#777777' },
    note: { fontSize: 11, color: '#777777', marginTop: 6 },
    btns: { flexDirection: 'row', marginTop: 18 },
    ghost: { flex: 1, borderWidth: 1, paddingVertical: 11, alignItems: 'center', marginRight: 10 },
    ghostTxt: { fontSize: 14, fontWeight: '800' },
    solid: { flex: 1, paddingVertical: 12, alignItems: 'center' },
    solidTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});