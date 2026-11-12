// Riders tab: the delivery team. Who is online and busy, the cash each rider owes the shop, and quick links to the live map,
// performance and delivery rules. Tap a rider for his page (cash history, handover, orders, switch off).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { setRiderAttention } from '../../store/owners/useAlertStore';
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
import { Image } from 'expo-image';
import { LeavePanel } from '../../components/owners/RiderLeave';
import { RiderBadge, BADGES } from '../../components/common/RiderBadge';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat, Tile, StatusDot } from '../../components/owners/RiderDesk';
import { tr } from '../../i18n';

export function Avatar({ rider, size = 44 }) {
    const { primary, onPrimary } = useBrand();
    const initial = riderName(rider).replace(/^Rider\s*/, '').charAt(0).toUpperCase() || 'R';
    if (rider?.photo) return <Image source={{ uri: rider.photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(primary, 0.16) }} contentFit="cover" />;
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

// one rider as a card on a computer: the round picture with his status colour, name and number, what he is doing, and three numbers
function RiderTile({ r, cashPaise, locked, onOpen, onToggle }) {
    const { text, muted, surface, border, ok, error, warn, primary } = useBrand();
    const tone = !r.isActive ? muted : r.isOnline ? ok : warn;
    const word = !r.isActive ? tr('Switched off') : r.isOnline ? tr('Online') : tr('Offline');
    const num = (label, value, color) => (
        <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: color || text, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{value}</Text>
            <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>{label}</Text>
        </View>
    );
    return (
        <View style={{ padding: 8 }}>
            <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 24, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 18, opacity: r.isActive ? 1 : 0.7, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View>
                        <Avatar rider={r} size={62} />
                        <View style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: tone, borderWidth: 3, borderColor: surface }} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17 }} numberOfLines={1}>{riderName(r)}</Text>
                        <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{r.phone || ''}</Text>
                    </View>
                    <Toggle value={r.isActive} onValueChange={onToggle} disabled={locked} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
                    <View style={{ marginRight: 6, marginBottom: 6 }}><StatusDot color={tone} label={word} /></View>
                    {r.activeOrderCount > 0 ? <View style={{ marginRight: 6, marginBottom: 6 }}><Pill label={tr('{activeOrderCount} on delivery', { activeOrderCount: r.activeOrderCount })} color={primary} icon="navigate" /></View> : null}
                    {r.ratingCount ? <View style={{ marginRight: 6, marginBottom: 6 }}><Pill label={`★ ${Number(r.ratingAvg).toFixed(1)}`} color="#D97706" /></View> : null}
                    {r.leave?.onLeaveToday ? <View style={{ marginRight: 6, marginBottom: 6 }}><Pill label={tr('On leave today')} color={warn} /></View> : null}
                    {r.leave?.pending > 0 ? <View style={{ marginRight: 6, marginBottom: 6 }}><Pill label={tr('Leave request')} color={warn} /></View> : null}
                    {r.standing ? <View style={{ marginBottom: 6 }}><RiderBadge badge={r.standing.badge} /></View> : null}
                </View>
                <View style={{ flexDirection: 'row', marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2) }}>
                    {num(tr('Deliveries'), String(r.deliveryCount || 0))}
                    {num(tr('Avg time'), r.avgDeliveryMin ? `${r.avgDeliveryMin}m` : '–')}
                    {num(tr('Cash held'), rupees(cashPaise), cashPaise > 0 ? error : undefined)}
                </View>
            </Pressable>
        </View>
    );
}

function AddSheet({ visible, onClose }) {
    const { muted, error } = useBrand();
    // the plan's number of riders (Partner 2): at the limit the sheet says so and does not add
    const limit = useMenuFlags((st) => st.plan?.limits?.riders);
    const count = useRidersStore((st) => st.riders.length);
    const atLimit = limit !== null && limit !== undefined && count >= limit;
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const ok = /^[6-9]\d{9}$/.test(phone);
    const submit = async () => {
        setBusy(true);
        try {
            await addRider(phone, name.trim() || undefined);
            showToast(tr('Rider added'));
            setPhone(''); setName('');
            onClose();
            useRidersStore.getState().load({ quiet: true });
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const desk = useOwnerDesktop();
    const { primary, text, border } = useBrand();
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Add a rider')}>
            {desk ? (
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="bicycle" size={38} color={primary} /></View>
                    <Text style={{ color: text, fontSize: 18, fontWeight: '900', marginTop: 10 }}>{tr('Welcome a new rider')}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        {[['call-outline', tr('Enter his number')], ['log-in-outline', tr('He logs in with it')], ['bicycle-outline', tr('He sees his deliveries')]].map(([ic, t2], i) => (
                            <View key={i} style={{ alignItems: 'center', width: 118, paddingHorizontal: 4 }}>
                                <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: border, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={18} color={primary} /></View>
                                <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700', textAlign: 'center', marginTop: 6 }}>{t2}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            ) : null}
            <Text style={{ color: muted, marginBottom: 10 }}>{tr('The rider logs in to this app with his phone number and sees his deliveries.')}</Text>
            <Field value={phone} onChangeText={(x) => setPhone(x.replace(/\D/g, '').slice(0, 10))} placeholder={tr('Mobile number (10 digits)')} maxLength={10} keyboardType="number-pad" style={{ marginBottom: 10 }} />
            <Field value={name} onChangeText={setName} placeholder={tr('Name (optional)')} maxLength={40} style={{ marginBottom: 14 }} />
            {atLimit ? <Text style={{ color: error, marginBottom: 10 }}>{tr('Your plan allows {n} riders. See Plan to upgrade.', { n: limit })}</Text> : null}
            <Button label={tr('Add rider')} icon="person-add" disabled={!ok || atLimit} busy={busy} onPress={submit} />
        </Sheet>
    );
}

export default function OwnerRidersScreen() {
    const desk = useOwnerDesktop();   // a computer: the riders in two columns
    const gcols = useGridCols(3, 310);   // fewer, wider cards in a narrow window
    const nav = useNavigation();
    useFocusEffect(useCallback(() => { setRiderAttention(false); }, []));   // he is looking at the riders now: the dot on the menu goes
    const { primary, muted, text, ok, error, warn } = useBrand();
    const s = useRidersStore();
    const easy = useMenuFlags((st) => st.easy);
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
            page
            wide
            title={tr('Riders')}
            onRefresh={() => useRidersStore.getState().load({ quiet: true })}
            refreshing={s.refreshing}
        >
            {s.loading ? <ListShimmer /> : null}
            {s.error && !s.riders.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={s.error} /> : null}

            {!s.loading && !(s.error && !s.riders.length) ? (
                <Frame desk={desk}>
                    {desk ? (
                        <>
                            <Hero icon="bicycle" title={tr('Your delivery team')} subtitle={s.riders.length ? tr('{online} online · {total} riders', { online, total: s.riders.length }) : tr('Add your first rider to start delivering')}
                                right={<>
                                    <HeroBtn label={tr('Live map')} icon="map-outline" onPress={() => nav.navigate('OwnerRiderMap')} />
                                    {!easy ? <HeroBtn label={tr('Performance')} icon="stats-chart-outline" onPress={() => nav.navigate('OwnerPerformance')} /> : null}
                                    {!easy ? <HeroBtn label={tr('Rules')} icon="options-outline" onPress={() => nav.navigate('OwnerRiderRules')} /> : null}
                                    <HeroBtn label={tr('Add a rider')} icon="person-add" solid onPress={() => setAdding(true)} />
                                </>}>
                                <View style={{ flexDirection: 'row', marginTop: 20 }}>
                                    <GlassStat label={tr('Online now')} value={String(online)} icon="radio-button-on" />
                                    <GlassStat label={tr('On delivery')} value={String(s.riders.filter((x) => x.activeOrderCount > 0).length)} icon="navigate-outline" />
                                    <GlassStat label={tr('Cash with riders')} value={rupees(s.totalOwedPaise)} icon="cash-outline" />
                                    <GlassStat label={tr('All riders')} value={String(s.riders.length)} icon="people-outline" />
                                </View>
                            </Hero>
                        </>
                    ) : null}
                    {desk ? null : <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label={tr('Online now')} value={`${online} of ${s.riders.filter((r) => r.isActive).length}`} color={online ? ok : text} />
                            <Stat label={tr('Cash with riders')} value={rupees(s.totalOwedPaise)} color={s.totalOwedPaise > 0 ? error : text} hint={s.totalOwedPaise > 0 ? tr('to collect') : tr('all settled')} />
                        </View>
                    </Card>}

                    {desk ? null : <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginBottom: 14 }}>
                        <Quick icon="map" label={tr('Live map')} onPress={() => nav.navigate('OwnerRiderMap')} />
                        {!easy ? <Quick icon="stats-chart" label={tr('Performance')} onPress={() => nav.navigate('OwnerPerformance')} /> : null}
                        {!easy ? <Quick icon="options" label={tr('Rules')} onPress={() => nav.navigate('OwnerRiderRules')} /> : null}
                    </View>}

                    {owing.length ? (
                        <>
                            <SectionTitle title={tr('Cash to collect')} />
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

                    {!easy && s.riders.filter((r) => r.standing && r.standing.points > 0).length ? (
                        <View>
                            <SectionTitle title={tr('Top riders (last 30 days)')} />
                            <Card>
                                {[...s.riders].filter((r) => r.standing && r.standing.points > 0).sort((a, b) => b.standing.points - a.standing.points).slice(0, 3).map((r, i) => (
                                    <View key={r.userId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                                        <Text style={{ width: 22, color: muted, fontWeight: '900' }}>{i + 1}</Text>
                                        <Text style={{ flex: 1, color: text, fontWeight: '800' }} numberOfLines={1}>{riderName(r)}</Text>
                                        <RiderBadge badge={r.standing.badge} />
                                        <Text style={{ color: text, fontWeight: '900', marginLeft: 10, minWidth: 44, textAlign: 'right' }}>{r.standing.points}</Text>
                                    </View>
                                ))}
                            </Card>
                        </View>
                    ) : null}

                    <LeavePanel />

                    <SectionTitle title={tr('Your riders ({length})', { length: s.riders.length })} />
                    {!s.riders.length ? <Empty icon="bicycle" title={tr('No riders yet')} hint={tr('Add a rider with his mobile number. He logs in to this app and gets delivery requests.')} /> : null}
                    <View style={desk ? { flexDirection: 'row', flexWrap: 'wrap' } : undefined}>
                    {s.riders.map((r) => (desk ? <View key={r.userId} style={{ width: `${100 / gcols}%` }}><RiderTile r={r} cashPaise={s.cash[String(r.userId)]?.balancePaise || 0} locked={access !== 'ok' && access !== 'paused'} onOpen={() => nav.navigate('OwnerRider', { userId: String(r.userId) })} onToggle={(on) => toggle(r, on)} /></View> : (
                        <View key={r.userId}>
                        <Card onPress={() => nav.navigate('OwnerRider', { userId: String(r.userId) })} style={{ opacity: r.isActive ? 1 : 0.6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Avatar rider={r} />
                                <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{riderName(r)}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{r.phone || ''}{!easy && r.ratingCount ? `  ·  ★ ${Number(r.ratingAvg).toFixed(1)} (${r.ratingCount})` : ''}{!easy && r.avgDeliveryMin ? tr('  ·  {avgDeliveryMin} min avg', { avgDeliveryMin: r.avgDeliveryMin }) : ''}</Text>
                                    <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                                        {!r.isActive ? <Pill label={tr('Switched off')} color={muted} /> : r.isOnline ? <Pill label={tr('Online')} color={ok} icon="radio-button-on" /> : <Pill label={tr('Offline')} color={muted} />}
                                        {r.standing && !easy ? <RiderBadge badge={r.standing.badge} /> : null}
                                        {r.leave?.onLeaveToday ? <Pill label={tr('On leave today')} color={warn} /> : null}
                                        {r.leave?.pending > 0 ? <Pill label={tr('Leave request')} color={warn} /> : null}
                                        {r.activeOrderCount > 0 ? <Pill label={tr('{activeOrderCount} on delivery', { activeOrderCount: r.activeOrderCount })} color={primary} icon="bicycle" /> : null}
                                    </View>
                                </View>
                                <Toggle value={r.isActive} onValueChange={(on) => toggle(r, on)} disabled={access !== 'ok' && access !== 'paused'} />
                            </View>
                        </Card>
                        </View>
                    )))}
                    </View>
                    <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
                        <Button label={tr('Add a rider')} icon="person-add" onPress={() => setAdding(true)} />
                    </View>
                </Frame>
            ) : null}
            <AddSheet visible={adding} onClose={() => setAdding(false)} />
        </OwnerScreen>
    );
}
