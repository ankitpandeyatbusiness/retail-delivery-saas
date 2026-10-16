// Riders tab: the delivery team. Who is online and busy, the cash each rider owes the shop, and quick links to the live map,
// performance and delivery rules. Tap a rider for his page (cash history, handover, orders, switch off).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, Pill, Button, Empty, Sheet, Field, SectionTitle, Stat } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { useRidersStore } from '../../store/owners/useRidersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { addRider, updateRider, apiError } from '../../api/owners/shopApi';
import { rupees, riderName } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';

export function Avatar({ rider, size = 44 }) {
    const { primary, onPrimary } = useBrand();
    const initial = riderName(rider).replace(/^Rider\s*/, '').charAt(0).toUpperCase() || 'R';
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: primary, fontWeight: '900', fontSize: size * 0.42 }}>{initial}</Text>
        </View>
    );
}

function Quick({ icon, label, onPress }) {
    const { primary, text, surface, border } = useBrand();
    return (
        <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 12, marginHorizontal: 4, borderRadius: 16, borderWidth: StyleSheetHair, borderColor: border, backgroundColor: surface, opacity: pressed ? 0.7 : 1 })}>
            <Ionicons name={icon} size={22} color={primary} />
            <Text style={{ color: text, fontWeight: '800', fontSize: 12, marginTop: 4 }}>{label}</Text>
        </Pressable>
    );
}
const StyleSheetHair = 0.8;

function AddSheet({ visible, onClose }) {
    const { muted } = useBrand();
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const ok = /^[6-9]\d{9}$/.test(phone);
    const submit = async () => {
        setBusy(true);
        try {
            await addRider(phone, name.trim() || undefined);
            showToast('Rider added');
            setPhone(''); setName('');
            onClose();
            useRidersStore.getState().load({ quiet: true });
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title="Add a rider">
            <Text style={{ color: muted, marginBottom: 10 }}>The rider logs in to this app with his phone number and sees his deliveries.</Text>
            <Field value={phone} onChangeText={(x) => setPhone(x.replace(/\D/g, '').slice(0, 10))} placeholder="Mobile number (10 digits)" maxLength={10} keyboardType="number-pad" style={{ marginBottom: 10 }} />
            <Field value={name} onChangeText={setName} placeholder="Name (optional)" maxLength={40} style={{ marginBottom: 14 }} />
            <Button label="Add rider" icon="person-add" disabled={!ok} busy={busy} onPress={submit} />
        </Sheet>
    );
}

export default function OwnerRidersScreen() {
    const nav = useNavigation();
    const { primary, muted, text, ok, error } = useBrand();
    const s = useRidersStore();
    const access = useOwnerStore((st) => st.access);
    const [adding, setAdding] = useState(false);

    useFocusEffect(useCallback(() => { useRidersStore.getState().load({ quiet: true }); }, []));

    const online = s.riders.filter((r) => r.isActive && r.isOnline).length;
    const owing = s.riders.filter((r) => (s.cash[String(r.userId)]?.balancePaise || 0) > 0);

    const toggle = async (r, on) => {
        useRidersStore.setState((st) => ({ riders: st.riders.map((x) => (x.userId === r.userId ? { ...x, isActive: on } : x)) }));
        try { await updateRider(r.userId, { isActive: on }); useRidersStore.getState().load({ quiet: true }); }
        catch (e) {
            useRidersStore.setState((st) => ({ riders: st.riders.map((x) => (x.userId === r.userId ? { ...x, isActive: !on } : x)) }));
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        }
    };

    return (
        <OwnerScreen
            title="Riders"
            onRefresh={() => useRidersStore.getState().load({ quiet: true })}
            refreshing={s.refreshing}
        >
            {s.loading ? <ListShimmer /> : null}
            {s.error && !s.riders.length ? <Empty icon="cloud-offline-outline" title="Could not load" hint={s.error} /> : null}

            {!s.loading && !(s.error && !s.riders.length) ? (
                <>
                    <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label="Online now" value={`${online} of ${s.riders.filter((r) => r.isActive).length}`} color={online ? ok : text} />
                            <Stat label="Cash with riders" value={rupees(s.totalOwedPaise)} color={s.totalOwedPaise > 0 ? error : text} hint={s.totalOwedPaise > 0 ? 'to collect' : 'all settled'} />
                        </View>
                    </Card>

                    <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginBottom: 14 }}>
                        <Quick icon="map" label="Live map" onPress={() => nav.navigate('OwnerRiderMap')} />
                        <Quick icon="stats-chart" label="Performance" onPress={() => nav.navigate('OwnerPerformance')} />
                        <Quick icon="options" label="Rules" onPress={() => nav.navigate('OwnerRiderRules')} />
                    </View>

                    {owing.length ? (
                        <>
                            <SectionTitle title="Cash to collect" />
                            <Card>
                                {owing.map((r, i) => (
                                    <Pressable key={r.userId} onPress={() => nav.navigate('OwnerRider', { userId: String(r.userId) })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: alpha(muted, 0.4) }}>
                                        <Avatar rider={r} size={36} />
                                        <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 12 }} numberOfLines={1}>{riderName(r)}</Text>
                                        <Text style={{ color: error, fontWeight: '900' }}>{rupees(s.cash[String(r.userId)].balancePaise)}</Text>
                                        <Ionicons name="chevron-forward" size={18} color={muted} style={{ marginLeft: 6 }} />
                                    </Pressable>
                                ))}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle title={`Your riders (${s.riders.length})`} />
                    {!s.riders.length ? <Empty icon="bicycle" title="No riders yet" hint="Add a rider with his mobile number. He logs in to this app and gets delivery requests." /> : null}
                    {s.riders.map((r) => (
                        <Card key={r.userId} onPress={() => nav.navigate('OwnerRider', { userId: String(r.userId) })} style={{ opacity: r.isActive ? 1 : 0.6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Avatar rider={r} />
                                <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{riderName(r)}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{r.phone || ''}{r.ratingCount ? `  ·  ★ ${Number(r.ratingAvg).toFixed(1)} (${r.ratingCount})` : ''}</Text>
                                    <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                        {!r.isActive ? <Pill label="Switched off" color={muted} /> : r.isOnline ? <Pill label="Online" color={ok} icon="radio-button-on" /> : <Pill label="Offline" color={muted} />}
                                        {r.activeOrderCount > 0 ? <View style={{ marginLeft: 6 }}><Pill label={`${r.activeOrderCount} on delivery`} color={primary} icon="bicycle" /></View> : null}
                                    </View>
                                </View>
                                <Toggle value={r.isActive} onValueChange={(on) => toggle(r, on)} disabled={access !== 'ok' && access !== 'paused'} />
                            </View>
                        </Card>
                    ))}
                    <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
                        <Button label="Add a rider" icon="person-add" onPress={() => setAdding(true)} />
                    </View>
                </>
            ) : null}
            <AddSheet visible={adding} onClose={() => setAdding(false)} />
        </OwnerScreen>
    );
}
