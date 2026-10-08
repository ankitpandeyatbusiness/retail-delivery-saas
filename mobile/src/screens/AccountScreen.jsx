// src/screens/AccountScreen.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, TextInput, Modal, ActivityIndicator, Pressable,
    KeyboardAvoidingView, Platform, StyleSheet, Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, GuestGate } from '../components/ui/kit';
import { showToast, tint } from '../components/ui/shop';
import { Press, Appear } from '../components/ui/cartParts';
import { AddressSheet } from '../components/ui/addresses';
import { themedAlert } from '../components/ui/dialog';
import { useAuthStore } from '../store/useAuthStore';
import { useHomeStore } from '../store/useHomeStore';
import { useThemeStore } from '../store/useThemeStore';
import { useFavStore } from '../store/shopStores';
import { fetchMe, updateMe, deleteMe } from '../api/shopApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function EditDialog({ visible, me, onClose, onSaved }) {
    const { primary, radius, text, muted, surface, border, background } = useBrand();
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

    const input = [s.input, { color: text, borderColor: border, backgroundColor: background }];
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[s.dialog, { backgroundColor: surface, borderColor: border }]}>
                    <Text style={[s.dTitle, { color: text }]}>Edit profile</Text>
                    <Text style={[s.label, { color: muted }]}>Name</Text>
                    <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Your name" placeholderTextColor={muted} style={input} />
                    <Text style={[s.label, { color: muted }]}>Email (optional)</Text>
                    <TextInput
                        value={email} onChangeText={setEmail} maxLength={120} placeholder="you@example.com" placeholderTextColor={muted}
                        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={input}
                    />
                    <Text style={[s.label, { color: muted }]}>Phone</Text>
                    <TextInput value={me?.phone ? `+91 ${me.phone}` : ''} editable={false} style={[s.input, { color: muted, borderColor: border, backgroundColor: border }]} />
                    <Text style={[s.note, { color: muted }]}>Your phone number is your login, so it cannot be changed.</Text>
                    <View style={s.btns}>
                        <Press wrap={{ flex: 1, marginRight: 10 }} onPress={onClose} style={[s.dBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.dTxt, { color: text }]}>Cancel</Text>
                        </Press>
                        <Press wrap={{ flex: 1.3 }} disabled={saving} onPress={save} style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[s.dTxt, { color: '#FFFFFF' }]}>Save</Text>}
                        </Press>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function Item({ icon, label, sub, onPress, danger, last }) {
    const { primary, text, muted, error, border } = useBrand();
    const c = danger ? error : primary;
    return (
        <Press onPress={onPress} style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={[s.rowIc, { backgroundColor: tint(c) }]}><Ionicons name={icon} size={18} color={c} /></View>
            <View style={{ flex: 1 }}>
                <Text style={[s.rowTxt, { color: danger ? error : text }]}>{label}</Text>
                {sub ? <Text style={[s.rowSub, { color: muted }]} numberOfLines={1}>{sub}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
        </Press>
    );
}

function Group({ title, delay, children }) {
    const { muted, surface, border } = useBrand();
    return (
        <Appear delay={delay} style={s.groupWrap}>
            {title ? <Text style={[s.gTitle, { color: muted }]}>{title}</Text> : null}
            <View style={[s.group, { backgroundColor: surface, borderColor: border }]}>{children}</View>
        </Appear>
    );
}

function AccountInner() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, text, muted, background, surface, border } = useBrand();
    const user = useAuthStore((st) => st.user);
    const favOn = useHomeStore((st) => st.full.features.favourites);
    const shop = useThemeStore((st) => st.theme.name);
    const shopPhone = useThemeStore((st) => st.theme.phone);
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

    const doLogout = () => themedAlert('Log out?', 'You will need to log in again to order.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', onPress: signOut },
    ], { icon: 'log-out-outline' });

    const doDelete = () => themedAlert(
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
                        if (m) themedAlert('Cannot delete account', m); else showToast('Network problem. Try again.');
                    } finally { setBusy(false); }
                },
            },
        ],
        { icon: 'trash-outline' },
    );

    const shopDigits = String(shopPhone || '').replace(/\D/g, '').slice(-10);
    const callShop = () => Linking.openURL(`tel:+91${shopDigits}`).catch(() => showToast('Could not open the dialer'));

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                <Text style={[s.title, { color: text }]}>Account</Text>

                <Appear style={[s.head, { backgroundColor: surface, borderColor: border }]}>
                    <View style={[s.avatar, { backgroundColor: primary }]}><Text style={s.avatarTxt}>{initial}</Text></View>
                    <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: text }]} numberOfLines={1}>{name || 'Add your name'}</Text>
                        {phone ? <Text style={[s.sub, { color: muted }]}>{phone}</Text> : null}
                        {p.email ? <Text style={[s.sub, { color: muted }]} numberOfLines={1}>{p.email}</Text> : null}
                    </View>
                    <Press onPress={() => setEdit(true)} style={[s.editBtn, { borderColor: primary }]}>
                        <Ionicons name="create-outline" size={15} color={primary} />
                        <Text style={[s.editTxt, { color: primary }]}>Edit</Text>
                    </Press>
                </Appear>

                {!name ? (
                    <Appear delay={60} style={s.groupWrap}>
                        <Press onPress={() => setEdit(true)} style={[s.nudge, { backgroundColor: tint(primary), borderColor: primary }]}>
                            <Ionicons name="person-circle-outline" size={22} color={primary} />
                            <Text style={[s.nudgeTxt, { color: text }]}>Add your name so the shop knows who is ordering</Text>
                        </Press>
                    </Appear>
                ) : null}

                <Group title="YOUR ACCOUNT" delay={80}>
                    <Item icon="location-outline" label="Saved addresses" sub="Add, edit or remove delivery addresses" onPress={() => setAddrSheet(true)} last={!favOn} />
                    {favOn ? <Item icon="heart-outline" label="Favourites" sub="Dishes you saved" onPress={() => nav.navigate('Favourites')} last /> : null}
                </Group>

                {shopPhone ? (
                    <Group title="HELP" delay={140}>
                        <Item icon="call-outline" label={`Contact ${shop || 'the shop'}`} sub={`Call +91 ${shopDigits}`} onPress={callShop} last />
                    </Group>
                ) : null}

                <Group title="MANAGE" delay={200}>
                    <Item icon="log-out-outline" label="Log out" onPress={doLogout} />
                    <Item icon="trash-outline" label="Delete account" onPress={doDelete} danger last />
                </Group>

                <Text style={[s.ver, { color: muted }]}>{shop} · v{Constants.expoConfig?.version || '1.0'}</Text>
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
    title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, paddingHorizontal: 16, paddingTop: 14 },
    head: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, padding: 16, borderWidth: 1, borderRadius: 20 },
    avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    avatarTxt: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
    name: { fontSize: 18, fontWeight: '800' },
    sub: { fontSize: 12, marginTop: 2 },
    editBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
    editTxt: { fontSize: 13, fontWeight: '800', marginLeft: 4 },
    nudge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 12 },
    nudgeTxt: { flex: 1, fontSize: 13, fontWeight: '700', marginLeft: 10 },
    groupWrap: { marginHorizontal: 16, marginTop: 18 },
    gTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
    group: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
    rowIc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    rowTxt: { fontSize: 14, fontWeight: '700' },
    rowSub: { fontSize: 11, marginTop: 2 },
    ver: { textAlign: 'center', fontSize: 11, marginTop: 26 },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    dialog: { width: '100%', maxWidth: 380, borderRadius: 22, borderWidth: 1, padding: 20 },
    dTitle: { fontSize: 18, fontWeight: '900', marginBottom: 4 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4 },
    input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14 },
    note: { fontSize: 11, marginTop: 6 },
    btns: { flexDirection: 'row', marginTop: 18 },
    dBtn: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
    dTxt: { fontSize: 14, fontWeight: '800' },
});