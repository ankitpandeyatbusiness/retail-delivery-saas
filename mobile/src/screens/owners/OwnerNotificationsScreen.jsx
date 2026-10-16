// The owner's inbox: messages from the platform and the shop's own events.
// Opening this screen marks everything as read (the dot stays on the new ones until you leave, so you can see what is new).
// "Clear all" removes the messages from the list.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Empty } from '../../components/owners/ui';
import { fetchShopNotifications, readAllShopNotifications, clearShopNotifications, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ago } from '../../utils/owners/riderRules';
import { ownerRoute } from '../../utils/owners/notificationRoute';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ListShimmer } from '../../components/owners/shimmer';

export default function OwnerNotificationsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const fresh = useRef(new Set());   // ids that were unread when this screen opened

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchShopNotifications({ page: p, limit: 20 });
            if (p === 1) fresh.current = new Set(r.items.filter((n) => !n.read).map((n) => n.id));
            else r.items.filter((n) => !n.read).forEach((n) => fresh.current.add(n.id));
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
            if (r.unreadCount > 0) {   // visiting the screen is reading it
                readAllShopNotifications().catch(() => { });
            }
            useOwnerStore.setState({ unread: 0 });
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your messages.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(1); }, [load]));

    const clearAll = async () => {
        const yes = await ask({ title: 'Clear all messages?', message: 'They disappear from this list.', confirmText: 'Clear all', destructive: true });
        if (!yes) return;
        try {
            await clearShopNotifications();
            fresh.current = new Set(); setItems([]); setMore(false);
            useOwnerStore.setState({ unread: 0 });
        } catch (e) { showToast(apiError(e)); }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Messages for you" right={items && items.length ? <Pressable onPress={clearAll} hitSlop={10}><Text style={{ color: primary, fontWeight: '800' }}>Clear all</Text></Pressable> : null} />
            <FlatList
                data={items || []}
                keyExtractor={(n) => String(n.id)}
                contentContainerStyle={{ paddingBottom: 60 }}
                renderItem={({ item: n }) => {
                    const isNew = fresh.current.has(n.id);
                    const go = ownerRoute(n);
                    return (
                        <Pressable disabled={!go} onPress={() => nav.navigate(go.name, go.params)} style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 13, backgroundColor: isNew ? alpha(primary, 0.07) : 'transparent' }}>
                            <View style={{ width: 10, paddingTop: 6 }}>{isNew ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: primary }} /> : null}</View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: isNew ? '900' : '700' }}>{n.title}</Text>
                                {n.body ? <Text style={{ color: muted, marginTop: 2 }}>{n.body}</Text> : null}
                                <Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>{ago(n.createdAt)}</Text>
                            </View>
                            {go ? <Ionicons name="chevron-forward" size={18} color={muted} style={{ alignSelf: 'center', marginLeft: 6 }} /> : null}
                        </Pressable>
                    );
                }}
                ListEmptyComponent={items === null ? <ListShimmer rows count={6} /> : err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : <Empty icon="notifications-off-outline" title="No messages" hint="Messages from the platform and about your shop appear here." />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>Show more</Text></Pressable> : null}
            />
        </View>
    );
}
