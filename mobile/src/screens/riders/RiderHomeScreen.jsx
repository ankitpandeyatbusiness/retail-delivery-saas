// src/screens/RiderHomeScreen.jsx
// What a user with role "rider" sees instead of the shop tabs: go online, accept offers, mark picked up,
// deliver with the customer's PIN. While an order is in progress the phone sends its location
// (the customer sees the bike on the map).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet, Switch, Linking,
    Modal, TextInput, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { tint, showToast } from '../../components/customers/shop';
import { themedAlert, ask } from '../../components/common/dialog';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useRiderLocation } from '../../hooks/common/useRiderLocation';
import {
    fetchRiderMe, setOnline, fetchRiderOrders, acceptOrder, rejectOrder, pickupOrder, deliverOrder, reportProblem,
} from '../../api/riders/riderApi';
import { takeAndUploadMyPhoto, takeAndUploadProof, removeMyPhoto } from '../../utils/riders/riderPhotos';

const TABS = [['offered', 'New'], ['active', 'Active'], ['history', 'History']];
const REASONS = [
    ['cannot_reach', 'Cannot reach the address'],
    ['customer_not_answering', 'Customer is not answering'],
    ['wrong_address', 'Wrong address'],
];
const POLL_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

const msg = (e, fallback) => e?.response?.data?.error || e?.response?.data?.message || fallback;
const rupee = (n) => `₹${Number(n || 0).toFixed(0)}`;
const addressLine = (a = {}) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');

export default function RiderHomeScreen() {
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, text, muted, surface, border, background, error } = useBrand();
    const logout = useAuthStore((s) => s.logout);
    const nav = useNavigation();

    const [me, setMe] = useState(null);
    const [tab, setTab] = useState('active');
    const [items, setItems] = useState([]);
    const [counts, setCounts] = useState({ offered: 0, active: 0 });
    const [state, setState] = useState('loading');   // loading | ok | error
    const [refreshing, setRefreshing] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [pinFor, setPinFor] = useState(null);      // order waiting for the delivery PIN
    const [pin, setPin] = useState('');
    const tabRef = useRef(tab);
    tabRef.current = tab;

    const load = useCallback(async (which = tabRef.current) => {
        try {
            const [r, m] = await Promise.all([fetchRiderOrders(which), fetchRiderMe()]);
            if (which !== tabRef.current) return;
            setItems(r.items || []); setCounts(r.counts || { offered: 0, active: 0 }); setMe(m); setState('ok');
        } catch (e) {
            setState((s) => (s === 'ok' ? 'ok' : 'error'));
        }
    }, []);

    useEffect(() => { setState((s) => (s === 'ok' ? s : 'loading')); load(tab); }, [tab, load]);

    // new offers arrive while the screen is open
    useFocusEffect(useCallback(() => {
        const id = setInterval(() => load(), POLL_MS);
        return () => clearInterval(id);
    }, [load]));

    // the phone sends its location while an order is in progress
    useRiderLocation(counts.active > 0);

    // his own picture
    const [photoBusy, setPhotoBusy] = useState(false);
    const changePhoto = () => themedAlert('Your photo', 'Customers and the shop see this picture.', [
        { text: 'Take a photo', onPress: () => doMyPhoto('camera') },
        { text: 'Choose from gallery', onPress: () => doMyPhoto('gallery') },
        ...(me?.photo ? [{ text: 'Remove photo', style: 'destructive', onPress: async () => {
            setPhotoBusy(true);
            try { await removeMyPhoto(); setMe((m) => ({ ...m, photo: null })); showToast('Photo removed'); } catch (e) { showToast(msg(e, 'Could not remove the photo')); }
            setPhotoBusy(false);
        } }] : []),
        { text: 'Cancel', style: 'cancel' },
    ], { icon: 'person-circle-outline' });
    const doMyPhoto = async (source) => {
        setPhotoBusy(true);
        try {
            const r = await takeAndUploadMyPhoto(source);
            if (r) { setMe((m) => ({ ...m, photo: r.photo })); showToast('Photo saved'); }
        } catch (e) { showToast(e.safe ? e.message : msg(e, 'Could not save the photo')); }
        setPhotoBusy(false);
    };

    // the photo of the food handed over: proof of a safe delivery
    const takeProof = async (o) => {
        setBusyId(o.id);
        try {
            const r = await takeAndUploadProof(o.id);
            if (r) showToast('Delivery photo saved');
            return !!r;
        } catch (e) { showToast(e.safe ? e.message : msg(e, 'Could not save the photo')); return false; } finally { setBusyId(null); load(); }
    };

    const toggleOnline = async (v) => {
        setMe((m) => ({ ...m, isOnline: v }));
        try { await setOnline(v); } catch (e) {
            setMe((m) => ({ ...m, isOnline: !v }));
            showToast(msg(e, 'Could not change your status'));
        }
    };

    const run = async (o, fn, okText) => {
        setBusyId(o.id);
        try {
            await fn();
            if (okText) showToast(okText);
        } catch (e) { showToast(msg(e, 'Something went wrong. Try again.')); }
        setBusyId(null);
        load();
    };

    const onAccept = (o) => run(o, () => acceptOrder(o.id), 'Order accepted');
    const onReject = async (o) => {
        if (await ask({ title: 'Reject this order?', message: 'It will be offered to another rider.', confirmText: 'Reject', destructive: true })) {
            run(o, () => rejectOrder(o.id));
        }
    };
    const onPickup = (o) => run(o, () => pickupOrder(o.id), 'Marked as picked up');
    const proceedDeliver = (o) => {
        if (o.delivery?.pinRequired) { setPin(''); setPinFor(o); return; }
        run(o, () => deliverOrder(o.id), 'Delivered');
    };
    const onDeliver = (o) => {
        if (o.delivery?.proof?.url) { proceedDeliver(o); return; }
        if (!o.delivery?.pinRequired) {
            // this shop has no delivery PIN, so the photo is the proof and cannot be skipped
            themedAlert('Photo needed', 'Take a photo of the food handed over to finish this delivery.', [
                { text: 'Take photo', onPress: async () => { if (await takeProof(o)) proceedDeliver(o); } },
                { text: 'Cancel', style: 'cancel' },
            ], { icon: 'camera-outline' });
            return;
        }
        themedAlert('Add a delivery photo?', 'A photo of the food handed over protects you if the customer says it did not arrive.', [
            { text: 'Take photo', onPress: async () => { await takeProof(o); proceedDeliver(o); } },
            { text: 'Skip', onPress: () => proceedDeliver(o) },
            { text: 'Cancel', style: 'cancel' },
        ], { icon: 'camera-outline' });
    };
    const submitPin = async () => {
        const o = pinFor;
        if (!o || pin.length < 4) return;
        setPinFor(null);
        setBusyId(o.id);
        try {
            await deliverOrder(o.id, pin);
            showToast('Delivered');
        } catch (e) { themedAlert('Could not deliver', msg(e, 'Wrong PIN. Try again.')); }
        setBusyId(null);
        load();
    };
    const onProblem = (o) => themedAlert('What is the problem?', 'The shop will be told.', [
        ...REASONS.map(([k, label]) => ({
            text: label,
            onPress: () => run(o, () => reportProblem(o.id, k), 'The shop has been told'),
        })),
        { text: 'Cancel', style: 'cancel' },
    ], { icon: 'warning-outline' });

    const navigate = (o) => {
        const a = o.address || {};
        const q = a.latitude != null && a.longitude != null ? `${a.latitude},${a.longitude}` : encodeURIComponent(addressLine(a));
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`).catch(() => showToast('Could not open Maps'));
    };
    const call = (o) => o.customer?.phone && Linking.openURL(`tel:${o.customer.phone}`).catch(() => { });

    const Btn = ({ label, onPress, solid, danger, icon, busy }) => (
        <Pressable
            onPress={onPress}
            disabled={busy}
            style={[s.btn, solid ? { backgroundColor: danger ? error : primary } : { borderColor: danger ? error : border, borderWidth: 1 }, busy && { opacity: 0.6 }]}
        >
            {icon ? <Ionicons name={icon} size={16} color={solid ? onPrimary : (danger ? error : text)} style={{ marginRight: 6 }} /> : null}
            <Text style={[s.btnTxt, { color: solid ? onPrimary : (danger ? error : text) }]}>{label}</Text>
        </Pressable>
    );

    const renderItem = ({ item: o }) => {
        const ds = o.delivery?.status;
        const busy = busyId === o.id;
        const cod = o.payment?.collectAmount > 0;
        return (
            <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                <View style={s.rowBetween}>
                    <Text style={[s.orderNo, { color: text }]}>Order #{o.orderNo}</Text>
                    {cod ? (
                        <View style={[s.pill, { backgroundColor: tint(primary) }]}>
                            <Text style={[s.pillTxt, { color: primary }]}>Collect {rupee(o.payment.collectAmount)}</Text>
                        </View>
                    ) : <Text style={[s.sub, { color: muted }]}>Paid</Text>}
                </View>
                <Text style={[s.items, { color: muted }]} numberOfLines={2}>
                    {(o.items || []).map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                </Text>
                <View style={s.addr}>
                    <Ionicons name="location-outline" size={16} color={muted} />
                    <Text style={[s.addrTxt, { color: text }]}>{addressLine(o.address) || 'Address after you accept'}</Text>
                </View>
                {o.customer?.name ? <Text style={[s.sub, { color: muted }]}>{o.customer.name}</Text> : null}
                {o.note ? <Text style={[s.sub, { color: muted }]}>Note: {o.note}</Text> : null}

                {tab === 'offered' ? (
                    <View style={s.actions}>
                        <Btn label="Reject" onPress={() => onReject(o)} danger busy={busy} />
                        <Btn label="Accept" onPress={() => onAccept(o)} solid busy={busy} />
                    </View>
                ) : null}

                {tab === 'active' ? (
                    <>
                        <View style={s.actions}>
                            <Btn label="Navigate" icon="navigate-outline" onPress={() => navigate(o)} />
                            {o.customer?.phone ? <Btn label="Call" icon="call-outline" onPress={() => call(o)} /> : null}
                            <Btn label="Problem" icon="warning-outline" onPress={() => onProblem(o)} danger />
                        </View>
                        {ds === 'picked_up' ? (
                            <View style={s.proofRow}>
                                {o.delivery?.proof?.url ? <Image source={{ uri: o.delivery.proof.url }} style={s.proofImg} /> : null}
                                <Btn
                                    label={o.delivery?.proof?.url ? 'Retake delivery photo' : 'Take delivery photo (optional)'}
                                    icon="camera-outline"
                                    onPress={() => takeProof(o)}
                                    busy={busy}
                                />
                            </View>
                        ) : null}
                        <View style={[s.actions, { marginTop: 8 }]}>
                            {ds === 'accepted'
                                ? <Btn label="Picked up from shop" onPress={() => onPickup(o)} solid busy={busy} />
                                : <Btn label={o.delivery?.pinRequired ? 'Delivered (enter PIN)' : 'Delivered'} onPress={() => onDeliver(o)} solid busy={busy} />}
                        </View>
                    </>
                ) : null}

                {tab === 'history' ? (
                    <>
                        <Text style={[s.sub, { color: muted, marginTop: 8 }]}>
                            {o.status === 'delivered' ? 'Delivered' : o.status === 'cancelled' ? 'Cancelled' : o.status}
                        </Text>
                        {o.delivery?.proof?.url ? (
                            <View style={s.proofRow}><Image source={{ uri: o.delivery.proof.url }} style={s.proofImg} /><Text style={[s.sub, { color: muted, flex: 1 }]}>Delivery photo saved</Text></View>
                        ) : o.status === 'delivered' && o.delivery?.deliveredAt && Date.now() - new Date(o.delivery.deliveredAt).getTime() < DAY_MS ? (
                            <View style={s.actions}><Btn label="Add delivery photo" icon="camera-outline" onPress={() => takeProof(o)} busy={busy} /></View>
                        ) : null}
                    </>
                ) : null}
            </View>
        );
    };

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <View style={[s.header, { paddingTop: insets.top + 10, backgroundColor: background, borderBottomColor: border }]}>
                <Pressable onPress={changePhoto} disabled={photoBusy} hitSlop={6} style={[s.avatar, { borderColor: border, backgroundColor: surface }]}>
                    {photoBusy ? <ActivityIndicator color={primary} /> : me?.photo
                        ? <Image source={{ uri: me.photo }} style={s.avatarImg} />
                        : <Ionicons name="person" size={22} color={muted} />}
                    <View style={[s.avatarBadge, { backgroundColor: primary }]}><Ionicons name="camera" size={10} color={onPrimary} /></View>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={[s.hTitle, { color: text }]}>{me?.name || 'Delivery partner'}</Text>
                    <Text style={[s.sub, { color: muted }]}>{me?.shop || ''}{me?.isOnline ? ' · Online' : ' · Offline'}</Text>
                </View>
                <Switch value={!!me?.isOnline} onValueChange={toggleOnline} trackColor={{ true: primary }} />
                <Pressable hitSlop={10} style={{ marginLeft: 14 }} onPress={() => nav.navigate('LegalList')}>
                    <Ionicons name="document-text-outline" size={22} color={muted} />
                </Pressable>
                <Pressable
                    hitSlop={10}
                    style={{ marginLeft: 14 }}
                    onPress={() => themedAlert('Log out?', 'You will stop getting orders.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Log out', style: 'destructive', onPress: () => logout().catch(() => { }) },
                    ], { icon: 'log-out-outline' })}
                >
                    <Ionicons name="log-out-outline" size={22} color={muted} />
                </Pressable>
            </View>

            <View style={s.tabs}>
                {TABS.map(([id, label]) => {
                    const on = tab === id;
                    const n = id === 'offered' ? counts.offered : id === 'active' ? counts.active : 0;
                    return (
                        <Pressable key={id} onPress={() => setTab(id)} style={[s.tab, on && { backgroundColor: primary }]}>
                            <Text style={[s.tabTxt, { color: on ? onPrimary : text }]}>{label}{n ? ` (${n})` : ''}</Text>
                        </Pressable>
                    );
                })}
            </View>

            {state === 'loading' ? (
                <View style={s.center}><ActivityIndicator color={primary} /></View>
            ) : state === 'error' ? (
                <View style={s.center}>
                    <Ionicons name="cloud-offline-outline" size={40} color={muted} />
                    <Text style={[s.empty, { color: text }]}>Could not load orders</Text>
                    <Pressable onPress={() => load()} style={[s.retry, { backgroundColor: primary }]}><Text style={{ color: onPrimary, fontWeight: '800' }}>Try again</Text></Pressable>
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(o) => String(o.id)}
                    renderItem={renderItem}
                    contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, flexGrow: 1 }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={primary} colors={[primary]} />}
                    ListEmptyComponent={(
                        <View style={s.center}>
                            <Ionicons name="bicycle-outline" size={44} color={muted} />
                            <Text style={[s.empty, { color: text }]}>
                                {tab === 'offered' ? (me?.isOnline ? 'No new orders yet' : 'Go online to get orders') : tab === 'active' ? 'No order in progress' : 'No past deliveries'}
                            </Text>
                        </View>
                    )}
                />
            )}

            <Modal visible={!!pinFor} transparent animationType="fade" onRequestClose={() => setPinFor(null)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalWrap}>
                    <View style={[s.modal, { backgroundColor: surface }]}>
                        <Text style={[s.hTitle, { color: text }]}>Delivery PIN</Text>
                        <Text style={[s.sub, { color: muted, marginBottom: 12 }]}>Ask the customer for the PIN shown in their app.</Text>
                        <TextInput
                            value={pin}
                            onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
                            keyboardType="number-pad"
                            autoFocus
                            maxLength={6}
                            placeholder="••••"
                            placeholderTextColor={muted}
                            style={[s.pinInput, { color: text, borderColor: border }]}
                        />
                        <View style={s.actions}>
                            <Btn label="Cancel" onPress={() => setPinFor(null)} />
                            <Btn label="Confirm delivery" onPress={submitPin} solid />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    hTitle: { fontSize: 18, fontWeight: '800' },
    sub: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
    tabs: { flexDirection: 'row', padding: 12, gap: 8 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
    tabTxt: { fontSize: 13.5, fontWeight: '800' },
    card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    orderNo: { fontSize: 15.5, fontWeight: '800' },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    pillTxt: { fontSize: 12, fontWeight: '800' },
    items: { fontSize: 13, fontWeight: '500', marginTop: 6 },
    addr: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, gap: 6 },
    addrTxt: { flex: 1, fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 12 },
    btnTxt: { fontSize: 13.5, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 280 },
    empty: { fontSize: 15.5, fontWeight: '800', marginTop: 12 },
    retry: { marginTop: 14, paddingHorizontal: 26, paddingVertical: 11, borderRadius: 12 },
    modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
    modal: { borderRadius: 18, padding: 18 },
    avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    avatarImg: { width: 44, height: 44, borderRadius: 22 },
    avatarBadge: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
    proofImg: { width: 52, height: 52, borderRadius: 10 },
    pinInput: { borderWidth: 1, borderRadius: 12, fontSize: 28, fontWeight: '800', letterSpacing: 8, textAlign: 'center', paddingVertical: 10 },
});
