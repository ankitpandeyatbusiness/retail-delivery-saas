// src/screens/NotificationsScreen.jsx
// The customer's inbox: order updates, rider news, payment receipts. Tapping one opens its order.
// Opening this screen marks everything as read (the rows that were new stay highlighted until you leave).
// "Clear all" deletes every message.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../../components/common/kit';
import { tint, showToast } from '../../components/customers/shop';
import { SkelNotifications } from '../../components/customers/skeletons';
import { ask } from '../../components/common/dialog';
import { fetchInbox, markAllRead, clearAll } from '../../api/common/notificationApi';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';
import { useClosedStyle } from '../../components/customers/shop';

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
    const setUnread = useNotificationStore((s) => s.set);

    const [items, setItems] = useState([]);
    const [state, setState] = useState('loading');   // loading | ok | error
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const busyMore = useRef(false);

    const load = useCallback(async () => {
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
        return onNotification(() => load());   // a new message while this screen is open
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
        const orderId = n.data?.orderId;
        if (orderId) nav.navigate('OrderDetail', { id: String(orderId) });
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
