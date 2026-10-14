import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, ScrollView, ActivityIndicator, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../theme';
import { Chip } from './ui';
import { SearchBar } from './inputs';
import { SkeletonList } from './blocks';
import { Empty, ErrorBox, Sheet, SheetScroll } from './feedback';
import { OrderRow } from './orderBits';
import Icon from './Icon';
import usePagedList from '../hooks/usePagedList';
import { listOrders } from '../api/ordersApi';
import { useShopsStore } from '../store/useShopsStore';

const STATUS_CHIPS = [
    { value: 'active', label: 'In progress' },
    { value: '', label: 'All' },
    { value: 'placed', label: 'New' },
    { value: 'preparing', label: 'Preparing' },
    { value: 'out_for_delivery', label: 'On the way' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled,undelivered', label: 'Cancelled' },
];
const DATE_CHIPS = [
    { value: 'all', label: 'Any time' },
    { value: 'today', label: 'Today' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
];

// start of today (India time) as an ISO string
const startOfTodayIst = () => {
    const ist = new Date(Date.now() + 330 * 60000);
    ist.setUTCHours(0, 0, 0, 0);
    return new Date(ist.getTime() - 330 * 60000).toISOString();
};
const fromOf = (v) => (v === 'today' ? startOfTodayIst() : v === 'all' ? undefined : new Date(Date.now() - Number(v) * 86400000).toISOString());

/*
 * Orders with search and filters. tenantId given = one shop only (no shop picker).
 * Embedded in a screen's scroll={false} body.
 */
export default function OrdersList({ tenantId, showShop = true, header }) {
    const t = useTheme();
    const nav = useNavigation();
    const shops = useShopsStore((s) => s.items);
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [status, setStatus] = useState('active');
    const [range, setRange] = useState('all');
    const [shopId, setShopId] = useState(tenantId || '');
    const [picker, setPicker] = useState(false);
    const first = useRef(true);

    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);
    useEffect(() => { if (!tenantId && !shops.length) useShopsStore.getState().load(); }, [tenantId, shops.length]);

    const params = useMemo(() => ({
        ...(shopId ? { tenantId: shopId } : {}),
        ...(status ? { status } : {}),
        ...(dq ? { q: dq } : {}),
        ...(range !== 'all' ? { from: fromOf(range) } : {}),
    }), [shopId, status, dq, range]);

    const list = usePagedList((page) => listOrders({ ...params, page, limit: 20 }), [params]);

    // back from the detail screen: the status may have changed
    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    const shopName = shops.find((s) => s._id === shopId)?.name;
    const filtered = !!(dq || status !== 'active' || range !== 'all' || (!tenantId && shopId));

    return (
        <View style={{ flex: 1 }}>
            {header}
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Order number or customer phone" />
            </View>
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {STATUS_CHIPS.map((c) => <Chip key={c.label} label={c.label} active={status === c.value} onPress={() => setStatus(c.value)} />)}
                </ScrollView>
            </View>
            <View style={{ height: 48 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {!tenantId ? (
                        <Chip label={shopId ? (shopName || 'Shop') : 'All shops'} active={!!shopId} icon="shops" onPress={() => setPicker(true)} />
                    ) : null}
                    {DATE_CHIPS.map((c) => <Chip key={c.value} label={c.label} active={range === c.value} icon={c.value === 'all' ? undefined : 'clock'} onPress={() => setRange(c.value)} />)}
                </ScrollView>
            </View>

            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(o) => String(o.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={
                        <Empty
                            icon="orders"
                            title={filtered ? 'No orders match' : 'No orders in progress'}
                            hint={filtered ? 'Try other filters, or "All" to see finished orders.' : 'New orders appear here as they arrive.'}
                        />
                    }
                    renderItem={({ item }) => (
                        <OrderRow order={item} showShop={showShop && !tenantId} onPress={() => nav.navigate('OrderDetail', { orderId: item.id, orderNo: item.orderNo })} />
                    )}
                />
            )}

            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shop?">
                <SheetScroll style={{ maxHeight: 380 }}>
                    <Pressable onPress={() => { setShopId(''); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }}>All shops</Text>
                        {!shopId ? <Icon name="ok" size={20} color={t.primary} /> : null}
                    </Pressable>
                    {shops.map((s) => (
                        <Pressable key={s._id} onPress={() => { setShopId(s._id); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{s.name}</Text>
                            {shopId === s._id ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
            </Sheet>
        </View>
    );
}
