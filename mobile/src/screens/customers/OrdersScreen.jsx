// src/screens/OrdersScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useBrand, GuestGate, CardGlow } from '../../components/common/kit';
import { Skel, FadeIn } from '../../components/common/motion';
import { tint } from '../../components/customers/shop';
import { Press, Appear } from '../../components/customers/cartParts';
import { StatusPill, itemsText, rs, isActive, cancelFlow, reorder } from '../../components/customers/orders';
import DateRangeSheet, { rangeLabel } from '../../components/customers/DateRangeSheet';

import { useHomeStore } from '../../store/customers/useHomeStore';
import { fetchOrders } from '../../api/customers/shopApi';
import { useAnyOrderLive } from '../../hooks/customers/useOrderLive';
import { viewInvoice } from '../../components/customers/invoice';

const PILLS = [['all', 'All'], ['active', 'Active'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
const FILTERS = {
    all: () => true,
    active: (o) => isActive(o.status),
    delivered: (o) => o.status === 'delivered',
    cancelled: (o) => o.status === 'cancelled',
};
const PAY = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', wallet: 'Wallet' };
const FLOW_DELIVERY = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
const FLOW_OTHER = ['placed', 'accepted', 'preparing', 'ready', 'delivered'];
const STEP = {
    placed: 'Order placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup',
    out_for_delivery: 'On the way', delivered: 'Delivered',
};
const STEP_ICON = {
    placed: 'receipt-outline', accepted: 'checkmark-done-outline', preparing: 'restaurant-outline', ready: 'bag-check-outline',
    out_for_delivery: 'bicycle-outline', delivered: 'checkmark-circle-outline',
};
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "Today", "Yesterday", "This week", then the month: the headings the list is grouped under
const dayLabel = (v) => {
    const d = new Date(v);
    const sod = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((sod(new Date()) - sod(d)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
};
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
    const to = () => { };   // no squeeze on press: the chip just fades to its new colour
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
    return (
        <View style={{ paddingTop: 6 }}>
            {[0, 1, 2].map((i) => (
                <View key={i} style={[s.card, { backgroundColor: surface, borderColor: border, padding: 16, flexDirection: 'column' }]}>
                    <View style={s.row}>
                        <View style={{ flex: 1 }}>
                            <Skel width="42%" height={16} />
                            <Skel width="62%" height={11} style={{ marginTop: 8 }} />
                        </View>
                        <Skel width={78} height={26} radius={13} />
                    </View>
                    <View style={[s.thumbRow, { marginTop: 14 }]}>
                        <Skel width={34} height={34} radius={17} />
                        <Skel width={34} height={34} radius={17} style={{ marginLeft: -10 }} />
                        <Skel width="55%" height={12} style={{ marginLeft: 12 }} />
                    </View>
                    <View style={[s.row, { marginTop: 18 }]}>
                        <Skel width={70} height={18} />
                        <Skel width={92} height={34} radius={12} />
                    </View>
                </View>
            ))}
        </View>
    );
}

// An order that is still in progress gets its own prominent card: the current step in big letters,
// a progress bar across the whole journey, and one clear way to follow it.
function LiveOrderCard({ o, onOpen }) {
    const { primaryLight, primaryDark, onPrimary, primary } = useBrand();
    const delivery = o.orderType === 'delivery';
    const flow = delivery ? FLOW_DELIVERY : FLOW_OTHER;
    const idx = Math.max(0, flow.indexOf(o.status));
    const pct = (idx + 1) / flow.length;
    const fill = useRef(new Animated.Value(pct)).current;
    const beat = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(fill, { toValue: pct, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [pct]);
    useEffect(() => {
        const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, []);
    const eta = o.etaMin ? `Ready in about ${o.etaMin} min` : (delivery ? 'Arriving soon' : 'We will let you know when it is ready');
    return (
        <Press onPress={onOpen} style={s.live}>
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.liveIn}>
                <View style={[s.blob, { top: -50, right: -30, width: 150, height: 150 }]} />
                <View style={[s.blob, { bottom: -60, left: 50, width: 110, height: 110, opacity: 0.6 }]} />
                <View style={s.row}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                        <View style={s.liveTag}>
                            <View style={s.beatWrap}>
                                <Animated.View style={[s.beat, { opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }] }]} />
                                <View style={s.beatDot} />
                            </View>
                            <Text style={[s.liveTagTxt, { color: onPrimary }]}>LIVE · ORDER #{o.orderNo}</Text>
                        </View>
                        <Text style={[s.liveStep, { color: onPrimary }]} numberOfLines={1}>{STEP[o.status] || 'In progress'}</Text>
                        <Text style={[s.liveEta, { color: onPrimary }]} numberOfLines={1}>{eta}</Text>
                    </View>
                    <View style={s.liveIc}>
                        <Ionicons name={STEP_ICON[o.status] || 'receipt-outline'} size={28} color={onPrimary} />
                    </View>
                </View>

                <View style={s.track}>
                    <Animated.View style={[s.trackFill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
                </View>
                <View style={[s.row, { marginTop: 6 }]}>
                    <Text style={[s.trackTxt, { color: onPrimary }]}>{STEP[flow[0]]}</Text>
                    <Text style={[s.trackTxt, { color: onPrimary }]}>{STEP[flow[flow.length - 1]]}</Text>
                </View>

                <View style={[s.row, { marginTop: 14 }]}>
                    <Text style={[s.liveItems, { color: onPrimary }]} numberOfLines={1}>{itemsText(o)}</Text>
                    <View style={s.liveBtn}>
                        <Text style={[s.liveBtnTxt, { color: primary }]}>Track</Text>
                        <Ionicons name="arrow-forward" size={14} color={primary} style={{ marginLeft: 4 }} />
                    </View>
                </View>
            </LinearGradient>
        </Press>
    );
}

function OrderCard({ o, index, animate, onOpen, onCancel, onReorder, onInvoice, reorderOn, busy }) {
    const { primary, text, muted, surface, border, error, ok } = useBrand();
    const active = isActive(o.status);
    const delivered = o.status === 'delivered';
    const accent = o.status === 'cancelled' ? error : delivered ? ok : primary;
    const list = o.items || [];
    const thumbs = list.slice(0, 3);
    const extra = list.length - thumbs.length;
    return (
        <Appear skip={!animate} delay={Math.min(index, 5) * 70}>
            <Press onPress={onOpen} style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                <CardGlow radius={18} />
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
    const nav = useNavigation();
    const { text, muted, surface, border, primary } = useBrand();
    const msg = ranged ? 'No orders in this period'
        : { all: 'No orders yet', active: 'No active orders', delivered: 'No delivered orders', cancelled: 'No cancelled orders' }[filter];
    return (
        <Appear style={s.center}>
            <View style={[s.emptyIc, { backgroundColor: surface, borderColor: border }]}>
                <Ionicons name={ranged ? 'calendar-outline' : 'receipt-outline'} size={42} color={muted} />
            </View>
            <Text style={[s.emptyBig, { color: text }]}>{msg}</Text>
            <Text style={[s.emptySub, { color: muted }]}>{ranged ? 'Try another date or clear the date filter.' : 'Your orders will show up here.'}</Text>
            {!ranged && filter === 'all' ? (
                <Press onPress={() => nav.navigate('Home')} style={[s.fill, { backgroundColor: primary, marginTop: 18, paddingHorizontal: 26, paddingVertical: 11 }]}>
                    <Text style={s.fillTxt}>Browse the menu</Text>
                </Press>
            ) : null}
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
    useAnyOrderLive(load);   // an order changed on the server: refresh the list

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
    // rows: a heading, then its orders. Orders in progress sit under "Live now" as big cards.
    const rows = useMemo(() => {
        const out = [];
        let last = '';
        filtered.forEach((o) => {
            const label = isActive(o.status) ? 'Live now' : dayLabel(o.createdAt);
            if (label !== last) { out.push({ h: label }); last = label; }
            out.push({ o });
        });
        return out;
    }, [filtered]);

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
                            data={rows} keyExtractor={(r, i) => (r.h ? `h-${r.h}-${i}` : r.o.id)}
                            refreshing={refreshing} onRefresh={refresh}
                            onEndReached={loadMore} onEndReachedThreshold={0.4}
                            ListEmptyComponent={hasMore ? null : <Empty filter={filter} ranged={!!range?.from} />}
                            ListFooterComponent={more ? <ActivityIndicator style={{ margin: 16 }} color={primary} /> : null}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
                            showsVerticalScrollIndicator={false}
                                renderItem={({ item: r, index }) => {
                                    if (r.h) return <Text style={[s.group, { color: r.h === 'Live now' ? primary : muted }]}>{r.h.toUpperCase()}</Text>;
                                    const o = r.o;
                                    if (isActive(o.status)) {
                                        return (
                                            <FadeIn index={index} distance={12}>
                                                <LiveOrderCard o={o} onOpen={() => nav.navigate('OrderDetail', { id: o.id })} />
                                            </FadeIn>
                                        );
                                    }
                                    return (
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
                                    );
                                }}
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
    // fixed height + centred on both axes; the font's own top/bottom padding is switched off so the text is
    // truly in the middle (otherwise Android draws it a little high)
    pill: { height: 38, paddingHorizontal: 18, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    pillRow: { flexDirection: 'row' },
    pillTxt: { fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    card: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, borderWidth: 1, borderRadius: 18, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    accent: { width: 4 },
    group: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
    live: { marginHorizontal: 16, marginBottom: 14, borderRadius: 22, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    liveIn: { padding: 18, overflow: 'hidden' },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
    liveTag: { flexDirection: 'row', alignItems: 'center' },
    beatWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    beat: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
    beatDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
    liveTagTxt: { fontSize: 11, fontWeight: '900', letterSpacing: 1, opacity: 0.9 },
    liveStep: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginTop: 8 },
    liveEta: { fontSize: 13, fontWeight: '600', marginTop: 3, opacity: 0.9 },
    liveIc: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)', marginTop: 18, overflow: 'hidden' },
    trackFill: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
    trackTxt: { fontSize: 10.5, fontWeight: '700', opacity: 0.8 },
    liveItems: { flex: 1, fontSize: 12.5, fontWeight: '600', opacity: 0.92, paddingRight: 12 },
    liveBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 9 },
    liveBtnTxt: { fontSize: 13, fontWeight: '900' },
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