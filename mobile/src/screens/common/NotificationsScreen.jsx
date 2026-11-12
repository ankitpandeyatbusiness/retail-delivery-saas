// src/screens/NotificationsScreen.jsx
// The customer's inbox: order updates, rider news, payment receipts. Tapping one opens its order.
// Opening this screen marks everything as read (the rows that were new stay highlighted until you leave).
// "Clear all" deletes every message.
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';
import { useCouponStore } from '../../store/customers/useCouponStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../../components/common/kit';
import { tint, showToast } from '../../components/customers/shop';
import { SkelNotifications } from '../../components/customers/skeletons';
import { ask } from '../../components/common/dialog';
import { fetchInbox, markAllRead, clearAll } from '../../api/common/notificationApi';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { onNotification, onNotificationRead } from '../../api/common/socket';
import { tr } from '../../i18n';
import { notificationTarget } from '../../utils/common/notificationTarget';
import { useClosedStyle } from '../../components/customers/shop';
import { useIsDesktopWeb, useStaffDesktop, useRiderDesktop } from '../../utils/common/layout';
import { Hero, HeroBtn } from '../../components/owners/RiderDesk';

const ICON = {
    order_status: 'receipt-outline',
    order_cancelled: 'close-circle-outline',
    rider_assigned: 'bicycle-outline',
    payment_received: 'card-outline',
    sms_topup_done: 'wallet-outline',
};

function ago(d) {
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const days = Math.round(h / 24);
    if (days < 7) return `${days} d ago`;
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
    const closedStyle = useClosedStyle();   // the shop is closed: a customer's screen turns grey
    const nav = useNavigation();
    const { primary, text, muted, surface, border, background, error } = useBrand();
    const staffDeskOnly = useStaffDesktop();
    const riderDesk = useRiderDesktop();
    const staffDesk = staffDeskOnly || riderDesk;   // the cook, the waiter and the rider on a computer: the same page as the owner's Messages (banner and rounded cards)
    const desk = useIsDesktopWeb();   // a browser at least 1024 px wide: a centred panel with tabs and day groups (false in the phone app)
    const [tab, setTab] = useState('all');   // desktop: all | unread
    const setUnread = useNotificationStore((s) => s.set);

    const [items, setItems] = useState([]);
    const [state, setState] = useState('loading');   // loading | ok | error
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const busyMore = useRef(false);

    const load = useCallback(async () => {
        useNotificationStore.getState().setDot(false);
        try {
            const r = await fetchInbox({ page: 1, limit: 20 });
            setItems(r.items); setPage(1); setMore(!!r.hasMore); setState('ok');
            if (r.unreadCount > 0) {
                setUnread(0);                          // seeing the inbox = reading it
                markAllRead().catch(() => { });
            } else setUnread(0);
        } catch (e) {
            setState((s) => (s === 'ok' ? 'ok' : 'error'));
        }
    }, [setUnread]);

    useFocusEffect(useCallback(() => {
        load();
        const a = onNotification(() => load());          // a new message while this screen is open
        const b = onNotificationRead(() => load());      // read or cleared on my other phone or browser
        return () => { a(); b(); };
    }, [load]));

    const loadMore = async () => {
        if (!more || busyMore.current) return;
        busyMore.current = true; setLoadingMore(true);
        try {
            const r = await fetchInbox({ page: page + 1, limit: 20 });
            setItems((cur) => {
                const seen = new Set(cur.map((x) => x.id));
                return [...cur, ...r.items.filter((x) => !seen.has(x.id))];
            });
            setPage(page + 1); setMore(!!r.hasMore);
        } catch (e) { /* the user can scroll again */ } finally { busyMore.current = false; setLoadingMore(false); }
    };

    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const open = (n) => {
        if (/^owed_/.test(String(n.type || n.data?.type || '')) || n.data?.type === 'table_walkout') { useOwedPrompt.getState().show(); return; }
        if (n.data?.offerCode) {   // the shop offers a discount to stay: the code is ready at checkout and the menu opens
            useCouponStore.getState().set(String(n.data.offerCode), n.data.offerUntil ? new Date(n.data.offerUntil).getTime() : 0, { percent: Number(n.data.offerPercent), min: Number(n.data.offerMin) });
            showToast(tr('Code {code} is ready at checkout', { code: String(n.data.offerCode) }));
            nav.navigate('MainTabs', { screen: 'Home' });
            return;
        }
        // the same place a tapped push would open (utils/common/notificationTarget.js): a bulk order, an inquiry, a booking, points, the table bill, the order, a leave
        const to = notificationTarget(useAuthStore.getState().user?.role, n);
        if (to) nav.navigate(to.name, to.params);
    };

    const clear = async () => {
        const yes = await ask({
            title: tr('Clear all notifications?'),
            message: tr('Every notification will be deleted. This cannot be undone.'),
            confirmText: tr('Clear all'),
            destructive: true,
            icon: 'trash-outline',
        });
        if (!yes) return;
        const before = items;
        setItems([]); setMore(false); setUnread(0);
        try { await clearAll(); } catch (e) {
            setItems(before);
            showToast(tr('Could not clear. Try again.'));
            load();
        }
    };

    const renderItem = ({ item: n }) => (
        <Pressable onPress={() => open(n)} style={[s.row, { backgroundColor: n.read ? surface : tint(primary), borderColor: border }]}>
            <View style={[s.ic, { backgroundColor: tint(primary) }]}>
                <Ionicons name={ICON[n.type] || 'notifications-outline'} size={20} color={primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.title, { color: text, fontWeight: n.read ? '600' : '800' }]}>{n.title}</Text>
                {n.body ? <Text style={[s.body, { color: muted }]}>{n.body}</Text> : null}
                <Text style={[s.time, { color: muted }]}>{ago(n.createdAt)}</Text>
            </View>
            {!n.read ? <View style={[s.dot, { backgroundColor: primary }]} /> : null}
        </Pressable>
    );

    if (staffDesk) {
        const unreadN = items.filter((n) => !n.read).length;
        return (
            <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={200}
                    onScroll={(e) => { const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent; if (contentOffset.y + layoutMeasurement.height > contentSize.height - 500) loadMore(); }}
                    contentContainerStyle={{ paddingTop: 28, paddingBottom: 64 }}
                >
                    <View style={{ width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 8 }}>
                        <Hero icon="notifications" title={tr('Notifications')} subtitle={unreadN ? tr('{n} new', { n: unreadN }) : tr('You are all caught up')}
                            right={<>
                                <HeroBtn icon="arrow-back" label={tr('Back')} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))} />
                                {items.length ? <HeroBtn solid icon="trash-outline" label={tr('Clear all')} onPress={clear} /> : null}
                            </>} />
                        <View style={{ paddingHorizontal: 16 }}>
                            {state === 'loading' ? <SkelNotifications />
                                : state === 'error' ? (
                                    <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                                        <Ionicons name="cloud-offline-outline" size={42} color={muted} />
                                        <Text style={[s.emptyBig, { color: text }]}>{tr('Could not load notifications')}</Text>
                                        <Pressable onPress={load} style={[s.btn, { backgroundColor: primary }]}><Text numberOfLines={1} style={s.btnTxt}>{tr('Try again')}</Text></Pressable>
                                    </View>
                                ) : !items.length ? (
                                    <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                                        <Ionicons name="notifications-off-outline" size={44} color={muted} />
                                        <Text style={[s.emptyBig, { color: text }]}>{tr('No notifications yet')}</Text>
                                        <Text style={[s.body, { color: muted, textAlign: 'center' }]}>{tr('Order updates will show up here.')}</Text>
                                    </View>
                                ) : items.map((n) => (
                                    <Pressable key={String(n.id)} onPress={() => open(n)} accessibilityRole="button"
                                        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, marginBottom: 8, borderRadius: 18, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? tint(primary) : n.read ? surface : tint(primary), cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                        <View style={{ width: 42, height: 42, borderRadius: 14, marginRight: 12, backgroundColor: n.read ? tint(primary) : primary, alignItems: 'center', justifyContent: 'center' }}>
                                            <Ionicons name={ICON[n.type] || 'notifications'} size={20} color={n.read ? primary : '#FFFFFF'} />
                                        </View>
                                        <View style={{ flex: 1, minWidth: 0 }}>
                                            <Text style={{ color: text, fontWeight: n.read ? '700' : '900' }}>{n.title}</Text>
                                            {n.body ? <Text style={{ color: muted, marginTop: 2 }}>{n.body}</Text> : null}
                                            <Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>{ago(n.createdAt)}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={muted} style={{ marginLeft: 6 }} />
                                    </Pressable>
                                ))}
                            {loadingMore ? <ListShimmer count={2} /> : null}
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    }

    if (desk) {
        // the desktop panel: a header with the counts and Clear all, All / Unread tabs, and the messages grouped by day
        const unreadN = items.filter((n) => !n.read).length;
        const shown = tab === 'unread' ? items.filter((n) => !n.read) : items;
        const sod = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
        const dayOf = (d) => { const diff = Math.round((sod(Date.now()) - sod(d)) / 86400000); return diff <= 0 ? tr('Today') : diff === 1 ? tr('Yesterday') : diff < 7 ? tr('This week') : tr('Earlier'); };
        const groups = [];
        shown.forEach((n) => { const h = dayOf(n.createdAt); const last = groups[groups.length - 1]; if (last && last.h === h) last.items.push(n); else groups.push({ h, items: [n] }); });
        const T = { transitionProperty: 'background-color, border-color, box-shadow, opacity', transitionDuration: '170ms' };
        const tabBtn = (k, label, count) => {
            const on = tab === k;
            return (
                <Pressable
                    key={k}
                    onPress={() => setTab(k)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1.5, borderColor: on || hovered ? primary : border, backgroundColor: on ? primary : hovered ? tint(primary) : surface, marginRight: 10, cursor: 'pointer', ...T })}
                >
                    <Text style={{ color: on ? '#FFFFFF' : text, fontSize: 13.5, fontWeight: '800' }}>{label}</Text>
                    {count > 0 ? (
                        <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, marginLeft: 8, backgroundColor: on ? 'rgba(255,255,255,0.25)' : primary, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{count > 99 ? '99+' : count}</Text>
                        </View>
                    ) : null}
                </Pressable>
            );
        };
        return (
            <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={200}
                    onScroll={(e) => { const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent; if (contentOffset.y + layoutMeasurement.height > contentSize.height - 500) loadMore(); }}
                    contentContainerStyle={{ paddingBottom: 90 }}
                >
                    <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 26 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Pressable
                                onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))}
                                accessibilityRole="button"
                                accessibilityLabel={tr('Back')}
                                style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: hovered ? border : 'transparent', cursor: 'pointer', ...T })}
                            >
                                <Ionicons name="arrow-back" size={24} color={text} />
                            </Pressable>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 }}>{tr('Notifications')}</Text>
                                <Text style={{ color: unreadN ? primary : muted, fontSize: 13.5, fontWeight: unreadN ? '700' : '500', marginTop: 2 }}>{unreadN ? tr('{n} new', { n: unreadN }) : tr('You are all caught up')}</Text>
                            </View>
                            {items.length ? (
                                <Pressable
                                    onPress={clear}
                                    accessibilityRole="button"
                                    style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: error, backgroundColor: hovered ? `${error}1A` : 'transparent', cursor: 'pointer', ...T })}
                                >
                                    <Ionicons name="trash-outline" size={16} color={error} />
                                    <Text style={{ color: error, fontSize: 13.5, fontWeight: '800', marginLeft: 7 }}>{tr('Clear all')}</Text>
                                </Pressable>
                            ) : null}
                        </View>

                        {state === 'ok' && items.length ? <View style={{ flexDirection: 'row', marginTop: 20 }}>{tabBtn('all', tr('All'), 0)}{tabBtn('unread', tr('Unread'), unreadN)}</View> : null}

                        <View style={{ marginTop: 18 }}>
                            {state === 'loading' ? <SkelNotifications />
                                : state === 'error' ? (
                                    <View style={{ alignItems: 'center', paddingVertical: 70 }}>
                                        <Ionicons name="cloud-offline-outline" size={42} color={muted} />
                                        <Text style={[s.emptyBig, { color: text }]}>{tr('Could not load notifications')}</Text>
                                        <Pressable onPress={load} style={({ hovered }) => ({ marginTop: 14, paddingHorizontal: 26, paddingVertical: 11, borderRadius: 12, backgroundColor: primary, filter: hovered ? 'brightness(1.12)' : 'brightness(1)', cursor: 'pointer', ...T })}><Text numberOfLines={1} style={s.btnTxt}>{tr('Try again')}</Text></Pressable>
                                    </View>
                                ) : !shown.length ? (
                                    <View style={{ alignItems: 'center', paddingVertical: 70 }}>
                                        <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }}>
                                            <Ionicons name={tab === 'unread' ? 'checkmark-done-outline' : 'notifications-off-outline'} size={36} color={muted} />
                                        </View>
                                        <Text style={[s.emptyBig, { color: text, marginTop: 18 }]}>{tab === 'unread' ? tr('You are all caught up') : tr('No notifications yet')}</Text>
                                        <Text style={[s.body, { color: muted, textAlign: 'center' }]}>{tab === 'unread' ? tr('Nothing new right now.') : tr('Order updates will show up here.')}</Text>
                                    </View>
                                ) : groups.map((g) => (
                                    <View key={g.h}>
                                        <Text style={{ color: muted, fontSize: 12, fontWeight: '900', letterSpacing: 1.3, marginTop: 8, marginBottom: 10 }}>{g.h.toUpperCase()}</Text>
                                        {g.items.map((n) => (
                                            <Pressable
                                                key={String(n.id)}
                                                onPress={() => open(n)}
                                                style={({ hovered }) => ({
                                                    flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10, cursor: 'pointer',
                                                    borderColor: hovered ? primary : n.read ? border : `${primary}55`,
                                                    backgroundColor: n.read ? (hovered ? tint(primary) : surface) : tint(primary),
                                                    boxShadow: hovered ? `0 10px 28px ${primary}26` : '0 0 0 rgba(0,0,0,0)', ...T,
                                                })}
                                            >
                                                {({ hovered }) => (
                                                    <>
                                                        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: n.read ? tint(primary) : primary, alignItems: 'center', justifyContent: 'center' }}>
                                                            <Ionicons name={ICON[n.type] || 'notifications-outline'} size={21} color={n.read ? primary : '#FFFFFF'} />
                                                        </View>
                                                        <View style={{ flex: 1, marginLeft: 14 }}>
                                                            <Text style={{ color: text, fontSize: 15, fontWeight: n.read ? '700' : '900' }}>{n.title}</Text>
                                                            {n.body ? <Text style={{ color: muted, fontSize: 13.5, fontWeight: '500', marginTop: 3, lineHeight: 19 }}>{n.body}</Text> : null}
                                                            <Text style={{ color: muted, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{ago(n.createdAt)}</Text>
                                                        </View>
                                                        {!n.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: primary, marginLeft: 10 }} /> : null}
                                                        <Ionicons name="chevron-forward" size={18} color={muted} style={{ marginLeft: 10, opacity: hovered ? 1 : 0.35, ...T }} />
                                                    </>
                                                )}
                                            </Pressable>
                                        ))}
                                    </View>
                                ))}
                            {loadingMore ? <ListShimmer count={2} /> : more && tab === 'all' ? (
                                <Pressable onPress={loadMore} style={({ hovered }) => ({ alignSelf: 'center', marginTop: 8, paddingHorizontal: 26, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: hovered ? primary : border, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', ...T })}>
                                    <Text style={{ color: text, fontWeight: '800', fontSize: 14 }}>{tr('Load older')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <BackHeader title={tr('Notifications')} />
            {state === 'loading' ? (
                <SkelNotifications />
            ) : state === 'error' ? (
                <View style={s.center}>
                    <Ionicons name="cloud-offline-outline" size={40} color={muted} />
                    <Text style={[s.emptyBig, { color: text }]}>{tr('Could not load notifications')}</Text>
                    <Pressable onPress={load} style={[s.btn, { backgroundColor: primary }]}><Text numberOfLines={1} style={s.btnTxt}>{tr('Try again')}</Text></Pressable>
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(n) => String(n.id)}
                    renderItem={renderItem}
                    contentContainerStyle={s.pad}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.4}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                    ListHeaderComponent={items.length ? (
                        <Pressable onPress={clear} hitSlop={8} style={s.readAll}>
                            <Text style={[s.readAllTxt, { color: error }]}>{tr('Clear all')}</Text>
                        </Pressable>
                    ) : null}
                    ListFooterComponent={loadingMore ? <ListShimmer count={2} /> : null}
                    ListEmptyComponent={(
                        <View style={s.center}>
                            <Ionicons name="notifications-off-outline" size={44} color={muted} />
                            <Text style={[s.emptyBig, { color: text }]}>{tr('No notifications yet')}</Text>
                            <Text style={[s.body, { color: muted, textAlign: 'center' }]}>{tr('Order updates will show up here.')}</Text>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    pad: { padding: 16, paddingBottom: 40, flexGrow: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 320 },
    row: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderWidth: 1, borderRadius: 16, marginBottom: 10 },
    ic: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 14.5 },
    body: { fontSize: 13, fontWeight: '500', marginTop: 3, lineHeight: 18 },
    time: { fontSize: 11.5, fontWeight: '600', marginTop: 6 },
    dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6, marginLeft: 8 },
    readAll: { alignSelf: 'flex-end', paddingVertical: 6, marginBottom: 6 },
    readAllTxt: { fontSize: 13, fontWeight: '800' },
    emptyBig: { fontSize: 16, fontWeight: '800', marginTop: 12, marginBottom: 6 },
    btn: { marginTop: 14, paddingHorizontal: 26, paddingVertical: 11, borderRadius: 12 },
    btnTxt: { color: '#FFFFFF', fontWeight: '800' },
});
