// src/screens/OrdersScreen.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, GuestGate } from '../components/ui/kit';
import { StatusPill, itemsText, rs, isActive, cancelFlow, reorder } from '../components/ui/orders';
import { useHomeStore } from '../store/useHomeStore';
import { fetchOrders } from '../api/shopApi';

const PILLS = [['all', 'All'], ['active', 'Active'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
const FILTERS = {
    all: () => true,
    active: (o) => isActive(o.status),
    delivered: (o) => o.status === 'delivered',
    cancelled: (o) => o.status === 'cancelled',
};

function OrderCard({ o, onOpen, onCancel, onReorder, reorderOn, busy }) {
    const { primary, radius, text } = useBrand();
    return (
        <Pressable onPress={onOpen} style={s.card}>
            <View style={s.row}>
                <Text style={[s.no, { color: text }]}>Order #{o.orderNo}</Text>
                <StatusPill status={o.status} />
            </View>
            <Text style={s.items} numberOfLines={2}>{itemsText(o)}</Text>
            <View style={s.row}>
                <Text style={[s.total, { color: text }]}>{rs(o.pricing?.total)} · COD</Text>
                <View style={s.btns}>
                    {o.canCancel ? (
                        <Pressable disabled={busy} onPress={onCancel} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: primary }]}>Cancel</Text>
                        </Pressable>
                    ) : null}
                    {reorderOn ? (
                        <Pressable disabled={busy} onPress={onReorder} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: primary }]}>Reorder</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

function OrdersList() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, text, background } = useBrand();
    const reorderOn = useHomeStore((st) => st.full.features.reorder);
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState('loading'); // loading | ok | error
    const [refreshing, setRefreshing] = useState(false);
    const [more, setMore] = useState(false);
    const [filter, setFilter] = useState('all');
    const [busyId, setBusyId] = useState('');

    const load = useCallback(async () => {
        try {
            const r = await fetchOrders({ page: 1, limit: 30 });
            setOrders(r.items || []);
            setPage(1);
            setHasMore(!!r.hasMore);
            setState('ok');
        } catch (e) { setState((st) => (st === 'ok' ? 'ok' : 'error')); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const filtered = useMemo(() => orders.filter(FILTERS[filter]), [orders, filter]);

    const loadMore = async () => {
        if (more || !hasMore || state !== 'ok') return;
        setMore(true);
        try {
            const r = await fetchOrders({ page: page + 1, limit: 30 });
            setOrders((p) => {
                const seen = new Set(p.map((x) => x.id));
                return [...p, ...(r.items || []).filter((x) => !seen.has(x.id))];
            });
            setPage(page + 1);
            setHasMore(!!r.hasMore);
        } catch (e) { /* keep what we have */ } finally { setMore(false); }
    };

    // a short filtered list: keep loading older pages
    useEffect(() => {
        if (state === 'ok' && hasMore && !more && filtered.length < 6) loadMore();
    }, [filtered.length, hasMore, state, page, filter]);

    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <Text style={[s.title, { color: text }]}>Your orders</Text>
            <View style={{ height: 50 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>
                    {PILLS.map(([k, label]) => (
                        <Pressable key={k} onPress={() => setFilter(k)} style={[s.pill, filter === k && { backgroundColor: primary, borderColor: primary }]}>
                            <Text style={[s.pillTxt, filter === k && { color: '#FFFFFF' }]}>{label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            </View>
            {state === 'loading' ? <ActivityIndicator style={{ margin: 40 }} color={primary} />
                : state === 'error' ? (
                    <View style={s.center}>
                        <Text style={s.empty}>Could not load your orders</Text>
                        <Pressable onPress={load}><Text style={[s.link, { color: primary }]}>Try again</Text></Pressable>
                    </View>
                ) : (
                    <FlatList
                        data={filtered} keyExtractor={(o) => o.id}
                        refreshing={refreshing} onRefresh={refresh}
                        onEndReached={loadMore} onEndReachedThreshold={0.4}
                        ListEmptyComponent={hasMore ? null : <Text style={s.empty}>No orders here yet</Text>}
                        ListFooterComponent={more ? <ActivityIndicator style={{ margin: 16 }} color={primary} /> : null}
                        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
                        renderItem={({ item: o }) => (
                            <OrderCard
                                o={o} reorderOn={reorderOn} busy={busyId === o.id}
                                onOpen={() => nav.navigate('OrderDetail', { id: o.id })}
                                onReorder={() => reorder(o, nav, (v) => setBusyId(v ? o.id : ''))}
                                onCancel={() => cancelFlow(o, {
                                    setBusy: (v) => setBusyId(v ? o.id : ''),
                                    onDone: (u) => setOrders((p) => p.map((x) => (x.id === u.id ? u : x))),
                                })}
                            />
                        )}
                    />
                )}
        </View>
    );
}

export default function OrdersScreen() {
    return <GuestGate title="Your orders"><OrdersList /></GuestGate>;
}

const s = StyleSheet.create({
    title: { fontSize: 20, fontWeight: '800', paddingHorizontal: 16, paddingTop: 14 },
    pills: { paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
    pill: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 18, backgroundColor: '#FFFFFF', marginRight: 8 },
    pillTxt: { fontSize: 12, fontWeight: '600', color: '#333333' },
    card: { marginHorizontal: 16, marginBottom: 14, borderWidth: 1, borderColor: '#EEEEEE', borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    no: { fontSize: 15, fontWeight: '800' },
    items: { fontSize: 12, color: '#777777', marginVertical: 8 },
    total: { fontSize: 14, fontWeight: '800' },
    btns: { flexDirection: 'row' },
    ghost: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginLeft: 8 },
    ghostTxt: { fontSize: 12, fontWeight: '800' },
    center: { padding: 40, alignItems: 'center' },
    empty: { fontSize: 14, color: '#777777', textAlign: 'center', padding: 40 },
    link: { fontSize: 13, fontWeight: '700' },
});