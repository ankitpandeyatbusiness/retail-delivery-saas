// src/screens/OrdersScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, GuestGate } from '../components/ui/kit';
import { tint } from '../components/ui/shop';
import { Press, Appear } from '../components/ui/cartParts';
import { StatusPill, itemsText, rs, isActive, cancelFlow, reorder } from '../components/ui/orders';
import DateRangeSheet, { rangeLabel } from '../components/ui/DateRangeSheet';

import { useHomeStore } from '../store/useHomeStore';
import { fetchOrders } from '../api/shopApi';
import { viewInvoice } from '../components/ui/invoice';

const PILLS = [['all', 'All'], ['active', 'Active'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
const FILTERS = {
    all: () => true,
    active: (o) => isActive(o.status),
    delivered: (o) => o.status === 'delivered',
    cancelled: (o) => o.status === 'cancelled',
};
const PAY = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', wallet: 'Wallet' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (v) => {
    const d = new Date(v);
    const h = d.getHours();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

function useChipAnim(on) {
    const a = useRef(new Animated.Value(on ? 1 : 0)).current;
    const p = useRef(new Animated.Value(1)).current;
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        Animated.timing(a, { toValue: on ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [on]);
    const to = (v) => Animated.spring(p, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
    return { a, p, to };
}

function FilterChip({ label, on, onPress }) {
    const { primary, surface, border, text } = useBrand();
    const { a, p, to } = useChipAnim(on);
    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [surface, primary] });
    const bd = a.interpolate({ inputRange: [0, 1], outputRange: [border, primary] });
    const fg = a.interpolate({ inputRange: [0, 1], outputRange: [text, '#FFFFFF'] });
    return (
        <Animated.View style={{ transform: [{ scale: p }], marginRight: 8 }}>
            <Pressable onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)}>
                <Animated.View style={[s.pill, { backgroundColor: bg, borderColor: bd }]}>
                    <Animated.Text style={[s.pillTxt, { color: fg }]}>{label}</Animated.Text>
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
}

function DateChip({ label, on, onPress, onClear }) {
    const { primary, surface, border, text } = useBrand();
    const { a, p, to } = useChipAnim(on);
    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [surface, primary] });
    const bd = a.interpolate({ inputRange: [0, 1], outputRange: [border, primary] });
    const fg = a.interpolate({ inputRange: [0, 1], outputRange: [text, '#FFFFFF'] });
    return (
        <Animated.View style={{ transform: [{ scale: p }], marginRight: 8 }}>
            <Pressable onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)}>
                <Animated.View style={[s.pill, s.pillRow, { backgroundColor: bg, borderColor: bd }]}>
                    <Ionicons name="calendar-outline" size={14} color={on ? '#FFFFFF' : text} style={{ marginRight: 6 }} />
                    <Animated.Text style={[s.pillTxt, { color: fg }]}>{on ? label : 'Date'}</Animated.Text>
                    {on ? (
                        <Pressable onPress={onClear} hitSlop={8} style={{ marginLeft: 8 }}>
                            <Ionicons name="close-circle" size={16} color="#FFFFFF" />
                        </Pressable>
                    ) : null}
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
}

function Skeleton() {
    const { surface, border } = useBrand();
    const v = useRef(new Animated.Value(0.5)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);
    const bar = (w, h, mt) => <View style={{ width: w, height: h, borderRadius: 7, backgroundColor: border, marginTop: mt }} />;
    return (
        <Animated.View style={{ opacity: v, paddingTop: 6 }}>
            {[0, 1, 2].map((i) => (
                <View key={i} style={[s.card, { backgroundColor: surface, borderColor: border, padding: 16, flexDirection: 'column' }]}>
                    {bar('45%', 16, 0)}{bar('30%', 11, 8)}{bar('100%', 42, 14)}{bar('60%', 14, 14)}
                </View>
            ))}
        </Animated.View>
    );
}

function OrderCard({ o, index, animate, onOpen, onCancel, onReorder, onInvoice, reorderOn, busy }) {
    const { primary, text, muted, surface, border, error } = useBrand();
    const active = isActive(o.status);
    const delivered = o.status === 'delivered';
    const accent = o.status === 'cancelled' ? error : delivered ? '#1E8E3E' : primary;
    const list = o.items || [];
    const thumbs = list.slice(0, 3);
    const extra = list.length - thumbs.length;
    return (
        <Appear skip={!animate} delay={Math.min(index, 5) * 70}>
            <Press onPress={onOpen} style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                <View style={[s.accent, { backgroundColor: accent }]} />
                <View style={s.cardIn}>
                    <View style={s.row}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={[s.no, { color: text }]}>Order #{o.orderNo}</Text>
                            <Text style={[s.date, { color: muted }]}>{fmtDate(o.createdAt)} · {o.orderType === 'delivery' ? 'Delivery' : 'Pickup'}</Text>
                        </View>
                        <StatusPill status={o.status} />
                    </View>

                    <View style={s.thumbRow}>
                        {thumbs.map((l, i) => (
                            <View key={`${l.productId}${i}`} style={[s.thumb, { backgroundColor: tint(primary), borderColor: surface, marginLeft: i ? -10 : 0 }]}>
                                {l.image ? <Image source={{ uri: l.image }} style={s.thumbImg} contentFit="cover" /> : <Ionicons name="fast-food-outline" size={16} color={primary} />}
                            </View>
                        ))}
                        {extra > 0 ? <View style={[s.thumb, { backgroundColor: border, borderColor: surface, marginLeft: -10 }]}><Text style={[s.more, { color: muted }]}>+{extra}</Text></View> : null}
                        <Text style={[s.items, { color: muted }]} numberOfLines={2}>{itemsText(o)}</Text>
                    </View>

                    <View style={[s.divider, { backgroundColor: border }]} />
                    <View style={s.row}>
                        <View>
                            <Text style={[s.total, { color: text }]}>{rs(o.pricing?.total)}</Text>
                            <Text style={[s.date, { color: muted }]}>{PAY[o.payment?.method] || 'Cash on delivery'}</Text>
                        </View>
                        <View style={s.btns}>
                            {o.canCancel ? (
                                <Press disabled={busy} onPress={onCancel} style={[s.ghost, { borderColor: error }]}>
                                    <Text style={[s.ghostTxt, { color: error }]}>Cancel</Text>
                                </Press>
                            ) : null}
                            {delivered ? (
                                <Press disabled={busy} onPress={onInvoice} style={[s.ghost, { borderColor: primary }]}>
                                    <View style={s.iconRow}>
                                        <Ionicons name="download-outline" size={14} color={primary} />
                                        <Text style={[s.ghostTxt, { color: primary, marginLeft: 4 }]}>Invoice</Text>
                                    </View>
                                </Press>
                            ) : null}
                            {active ? (
                                <Press onPress={onOpen} style={[s.fill, { backgroundColor: primary }]}>
                                    <Text style={s.fillTxt}>Track</Text>
                                </Press>
                            ) : reorderOn ? (
                                <Press disabled={busy} onPress={onReorder} style={[s.fill, { backgroundColor: primary }]}>
                                    {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.fillTxt}>Reorder</Text>}
                                </Press>
                            ) : null}
                        </View>
                    </View>
                </View>
            </Press>
        </Appear>
    );
}

function Empty({ filter, ranged }) {
    const { text, muted, surface, border } = useBrand();
    const msg = ranged ? 'No orders in this period'
        : { all: 'No orders yet', active: 'No active orders', delivered: 'No delivered orders', cancelled: 'No cancelled orders' }[filter];
    return (
        <Appear style={s.center}>
            <View style={[s.emptyIc, { backgroundColor: surface, borderColor: border }]}>
                <Ionicons name={ranged ? 'calendar-outline' : 'receipt-outline'} size={42} color={muted} />
            </View>
            <Text style={[s.emptyBig, { color: text }]}>{msg}</Text>
            <Text style={[s.emptySub, { color: muted }]}>{ranged ? 'Try another date or clear the date filter.' : 'Your orders will show up here.'}</Text>
        </Appear>
    );
}

function OrdersList() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, text, muted, background } = useBrand();
    const reorderOn = useHomeStore((st) => st.full.features.reorder);
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState('loading'); // loading | ok | error
    const [refreshing, setRefreshing] = useState(false);
    const [more, setMore] = useState(false);
    const [filter, setFilter] = useState('all');
    const intro = useRef(true);   // cards animate in only on the first load
    const [busyId, setBusyId] = useState('');
    const [range, setRange] = useState(null);      // { from, to, sort } or null
    const [sheet, setSheet] = useState(false);
    const fade = useRef(new Animated.Value(1)).current;
    const swap = useRef(false);

    // these go straight to GET /orders (from, to, sort)
    const qParams = useMemo(() => ({
        ...(range?.from ? { from: range.from, to: range.to || range.from } : {}),
        ...(range?.sort === 'oldest' ? { sort: 'oldest' } : {}),
    }), [range]);

    const endSwap = () => {
        if (!swap.current) return;
        swap.current = false;
        Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };

    const load = useCallback(async () => {
        try {
            const r = await fetchOrders({ page: 1, limit: 30, ...qParams });
            setOrders(r.items || []);
            setPage(1);
            setHasMore(!!r.hasMore);
            setState('ok');
        } catch (e) { setState((st) => (st === 'ok' ? 'ok' : 'error')); } finally { endSwap(); }
    }, [qParams]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    useEffect(() => {
        if (state !== 'ok') return undefined;
        const t = setTimeout(() => { intro.current = false; }, 900);
        return () => clearTimeout(t);
    }, [state]);

    // date filter: fade out, ask the server again, fade in when the new orders arrive
    const applyRange = (v) => {
        setSheet(false);
        if (JSON.stringify(v) === JSON.stringify(range)) return;
        Animated.timing(fade, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
            swap.current = true;
            setRange(v);
        });
    };

    const filtered = useMemo(() => orders.filter(FILTERS[filter]), [orders, filter]);

    const loadMore = async () => {
        if (more || !hasMore || state !== 'ok') return;
        setMore(true);
        try {
            const r = await fetchOrders({ page: page + 1, limit: 30, ...qParams });
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
    const activeCount = orders.filter((o) => isActive(o.status)).length;
    const dateText = [rangeLabel(range), range?.sort === 'oldest' ? 'Oldest first' : ''].filter(Boolean).join(' · ');

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <View style={s.head}>
                <Text style={[s.title, { color: text }]}>Your orders</Text>
                {range ? <Text style={[s.sub, { color: primary }]}>Showing: {dateText}</Text>
                    : activeCount ? <Text style={[s.sub, { color: primary }]}>{activeCount} active right now</Text>
                        : <Text style={[s.sub, { color: muted }]}>Track and reorder your favourites</Text>}
            </View>
            <View style={{ height: 54 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>
                    <DateChip label={dateText} on={!!range} onPress={() => setSheet(true)} onClear={() => applyRange(null)} />
                    {PILLS.map(([k, label]) => <FilterChip key={k} label={label} on={filter === k} onPress={() => setFilter(k)} />)}
                </ScrollView>
            </View>
            {state === 'loading' ? <Skeleton />
                : state === 'error' ? (
                    <Appear style={s.center}>
                        <Ionicons name="cloud-offline-outline" size={42} color={muted} />
                        <Text style={[s.emptyBig, { color: text, marginTop: 14 }]}>Could not load your orders</Text>
                        <Press onPress={load} style={[s.fill, { backgroundColor: primary, marginTop: 16, paddingHorizontal: 26, paddingVertical: 11 }]}>
                            <Text style={s.fillTxt}>Try again</Text>
                        </Press>
                    </Appear>
                ) : (
                    <Animated.View style={{ flex: 1, opacity: fade }}>
                        <FlatList
                            data={filtered} keyExtractor={(o) => o.id}
                            refreshing={refreshing} onRefresh={refresh}
                            onEndReached={loadMore} onEndReachedThreshold={0.4}
                            ListEmptyComponent={hasMore ? null : <Empty filter={filter} ranged={!!range?.from} />}
                            ListFooterComponent={more ? <ActivityIndicator style={{ margin: 16 }} color={primary} /> : null}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
                            showsVerticalScrollIndicator={false}
                                renderItem={({ item: o, index }) => (
                                    <OrderCard
                                        o={o} index={index} animate={intro.current} reorderOn={reorderOn} busy={busyId === o.id}
                                        onOpen={() => nav.navigate('OrderDetail', { id: o.id })}
                                        onReorder={() => reorder(o, nav, (v) => setBusyId(v ? o.id : ''))}
                                        onInvoice={() => viewInvoice(o, (v) => setBusyId(v ? o.id : ''))}
                                        onCancel={() => cancelFlow(o, {
                                            setBusy: (v) => setBusyId(v ? o.id : ''),
                                            onDone: (u) => setOrders((p) => p.map((x) => (x.id === u.id ? u : x))),
                                        })}
                                    />
                                )}
                        />
                    </Animated.View>
                )}
            <DateRangeSheet visible={sheet} value={range} onClose={() => setSheet(false)} onApply={applyRange} />
        </View>
    );
}

export default function OrdersScreen() {
    return <GuestGate title="Your orders"><OrdersList /></GuestGate>;
}

const s = StyleSheet.create({
    head: { paddingHorizontal: 16, paddingTop: 14 },
    title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    sub: { fontSize: 12, fontWeight: '700', marginTop: 2 },
    pills: { paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
    pill: { paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    pillRow: { flexDirection: 'row' },
    pillTxt: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
    card: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, borderWidth: 1, borderRadius: 18, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    accent: { width: 4 },
    cardIn: { flex: 1, padding: 14 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    no: { fontSize: 15, fontWeight: '900' },
    date: { fontSize: 11, fontWeight: '600', marginTop: 2 },
    thumbRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    thumb: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    thumbImg: { width: 34, height: 34 },
    more: { fontSize: 11, fontWeight: '800' },
    items: { flex: 1, fontSize: 12, lineHeight: 17, marginLeft: 10 },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
    total: { fontSize: 16, fontWeight: '900' },
    btns: { flexDirection: 'row', alignItems: 'center' },
    ghost: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
    ghostTxt: { fontSize: 12, fontWeight: '800' },
    iconRow: { flexDirection: 'row', alignItems: 'center' },
    fill: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', minWidth: 76 },
    fillTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    center: { padding: 40, alignItems: 'center', marginTop: 30 },
    emptyIc: { width: 92, height: 92, borderRadius: 46, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    emptyBig: { fontSize: 17, fontWeight: '800' },
    emptySub: { fontSize: 13, marginTop: 4, textAlign: 'center' },
});