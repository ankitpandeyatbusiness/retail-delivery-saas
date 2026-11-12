// Past deliveries, newest first. Plain rows: the order, when, and how it ended. Nothing to tap, nothing to learn.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { BigButton } from '../../components/riders/riderBits';
import { fetchRiderOrders, acceptOrder } from '../../api/riders/riderApi';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { showToast } from '../../components/customers/shop';
import { T, rupee, rupeeAmount, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';
import { useRiderDesktop } from '../../utils/common/layout';
import { Hero, GlassStat } from '../../components/owners/RiderDesk';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default function RiderHistoryScreen() {
    const insets = useSafeAreaInsets();
    const desk = useRiderDesktop();   // a computer: a banner with the numbers, the list in a centred column
    const { background, text, muted, surface, border, ok, error, primary, warn } = useBrand();
    const [items, setItems] = useState(null);
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [failed, setFailed] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const [missed, setMissed] = useState([]);   // offers whose time ran out before he answered
    const [busyId, setBusyId] = useState(null);
    const nav = useNavigation();

    const load = useCallback(async (p = 1) => {
        try {
            const [r, m] = await Promise.all([fetchRiderOrders('history', p), p === 1 ? fetchRiderOrders('missed').catch(() => null) : null]);
            if (m) setMissed(m.items || []);
            setItems((old) => (p === 1 ? r.items || [] : [...(old || []), ...(r.items || [])]));
            setMore(!!r.hasMore); setPage(p); setFailed('');
        } catch (e) { setFailed(errText(e)); setItems((x) => x || []); }
    }, []);
    // The deliveries he carries changed (he accepted or finished one, from anywhere): the list updates at once, not on the next visit
    const activeKey = useRiderStore((st) => st.active.map((o) => String(o.id)).join(','));
    const firstKey = useRef(true);
    useEffect(() => { if (firstKey.current) { firstKey.current = false; return; } load(1); }, [activeKey, load]);
    // opening History clears the red dot on its tab
    useFocusEffect(useCallback(() => { load(1); useRiderStore.getState().markMissedSeen(); }, [load]));

    // a missed order nobody has taken yet: he can still take it
    const take = async (o) => {
        setBusyId(o.id);
        try {
            await acceptOrder(o.id);
            setMissed((m) => m.filter((x) => String(x.id) !== String(o.id)));   // it is his now: gone from the missed list at once
            load(1);
            await useRiderStore.getState().load();
            nav.navigate('RiderTrip', { orderId: String(o.id) });
        } catch (e) {
            showToast(e?.response?.status === 409 ? T.taken : errText(e));
            load(1);
        }
        setBusyId(null);
    };

    // what is on screen: how many deliveries and what they earned
    const doneList = (items || []).filter((o) => o.status === 'delivered');
    const earned = doneList.reduce((n, o) => n + (o.earnPaise || 0), 0);

    const summary = (
        <View style={{ marginHorizontal: 16, marginBottom: 14, flexDirection: 'row' }}>
            <View style={{ flex: 1, marginRight: 8, borderRadius: 18, padding: 14, backgroundColor: alpha(primary, 0.1), borderWidth: 1, borderColor: alpha(primary, 0.16) }}>
                <Ionicons name="bicycle" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', fontSize: 24, marginTop: 6 }}>{doneList.length}</Text>
                <Text style={{ color: muted, fontWeight: '700', fontSize: 12.5 }}>{tr('Deliveries')}</Text>
            </View>
            <View style={{ flex: 1, borderRadius: 18, padding: 14, backgroundColor: alpha(ok, 0.1), borderWidth: 1, borderColor: alpha(ok, 0.16) }}>
                <Ionicons name="wallet" size={20} color={ok} />
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: text, fontWeight: '900', fontSize: 24, marginTop: 6 }}>{rupee(earned)}</Text>
                <Text style={{ color: muted, fontWeight: '700', fontSize: 12.5 }}>{tr('Earned')}</Text>
            </View>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            {desk ? (
                <View style={{ width: '100%', maxWidth: 900, alignSelf: 'center', paddingTop: 8 }}>
                    <Hero icon="time" title={T.history} subtitle={tr('Your deliveries and what they earned')}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            <GlassStat label={tr('Deliveries')} value={String(doneList.length)} icon="bicycle-outline" />
                            <GlassStat label={tr('Earned')} value={rupee(earned)} icon="wallet-outline" />
                            {missed.length ? <GlassStat label={tr('Missed orders')} value={String(missed.length)} icon="alert-circle-outline" /> : null}
                        </View>
                    </Hero>
                </View>
            ) : <Text style={{ color: text, fontSize: 24, fontWeight: '900', paddingHorizontal: 16, paddingTop: insets.top + 14, paddingBottom: 12 }}>{T.history}</Text>}
            {items === null ? <ListShimmer count={3} /> : (
                <FlatList
                    data={items}
                    keyExtractor={(o) => String(o.id)}
                    contentContainerStyle={{ paddingBottom: 24, flexGrow: 1, ...(desk ? { width: '100%', maxWidth: 900, alignSelf: 'center' } : null) }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
                    ListEmptyComponent={(
                        <View style={{ alignItems: 'center', padding: 40 }}>
                            <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name={failed ? 'cloud-offline-outline' : 'time-outline'} size={42} color={muted} />
                            </View>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 16, marginTop: 14, textAlign: 'center' }}>{failed || T.noHistory}</Text>
                        </View>
                    )}
                    ListHeaderComponent={(
                        <View>
                            {items.length && !desk ? summary : null}
                            {missed.length ? (
                                <View style={{ marginBottom: 6 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
                                        <Ionicons name="alert-circle" size={17} color={error} />
                                        <Text style={{ color: error, fontWeight: '900', fontSize: 14, marginLeft: 6 }}>{tr('Missed orders')}</Text>
                                    </View>
                                    {missed.map((o) => (
                                        <View key={String(o.id)} style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 18, padding: 14, paddingLeft: 20, backgroundColor: alpha(error, 0.07), borderWidth: 1, borderColor: alpha(error, 0.35), overflow: 'hidden' }}>
                                            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: error }} />
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Order #{orderNo}', { orderNo: o.ref || o.orderNo })}</Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                                <Ionicons name="time-outline" size={13} color={muted} />
                                                <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginLeft: 4 }}>{tr('You did not answer in time')} · {o.missed?.at ? when(o.missed.at) : ''}</Text>
                                            </View>
                                            {o.missed?.canTake ? (
                                                <View style={{ marginTop: 10 }}><BigButton label={tr('Still open: take it now')} busy={busyId === o.id} onPress={() => take(o)} /></View>
                                            ) : (
                                                <View style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, backgroundColor: alpha(muted, 0.15) }}>
                                                    <Text style={{ color: muted, fontWeight: '800', fontSize: 12 }}>{o.status === 'cancelled' ? tr('Cancelled') : tr('Taken by someone else')}</Text>
                                                </View>
                                            )}
                                        </View>
                                    ))}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 6, marginBottom: 8 }}>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 14 }}>{tr('Deliveries')}</Text>
                                        <View style={{ flex: 1, height: 1, backgroundColor: alpha(muted, 0.25), marginLeft: 10 }} />
                                    </View>
                                </View>
                            ) : null}
                        </View>
                    )}
                    ListFooterComponent={more ? <View style={{ padding: 16 }}><BigButton label={tr('Show more')} kind="outline" onPress={() => load(page + 1)} /></View> : null}
                    renderItem={({ item: o }) => {
                        const done = o.status === 'delivered';
                        const tone = done ? ok : error;
                        return (
                            <View style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 18, padding: 14, paddingLeft: 20, backgroundColor: surface, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
                                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: tone }} />
                                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(tone, 0.13), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                    <Ionicons name={done ? 'checkmark-circle' : 'close-circle'} size={24} color={tone} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Order #{orderNo}', { orderNo: o.ref || o.orderNo })}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                        <Ionicons name="time-outline" size={13} color={muted} />
                                        <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginLeft: 4 }}>{when(o.delivery?.deliveredAt || o.createdAt)}</Text>
                                    </View>
                                    {done && o.payment?.collectAmount > 0 ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                                            <Ionicons name="cash-outline" size={13} color={warn} />
                                            <Text style={{ color: muted, fontWeight: '700', fontSize: 12, marginLeft: 4 }}>{tr('{rupeeAmount} cash', { rupeeAmount: rupeeAmount(o.payment.collectAmount) })}</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: alpha(tone, 0.13) }}>
                                        <Text style={{ color: tone, fontWeight: '900', fontSize: 12.5 }}>{done ? tr('Delivered') : o.status === 'cancelled' ? tr('Cancelled') : tr('Not delivered')}</Text>
                                    </View>
                                    {done && o.earnPaise > 0 ? <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 6 }}>{rupee(o.earnPaise)}</Text> : null}
                                </View>
                            </View>
                        );
                    }}
                />
            )}
        </View>
    );
}
