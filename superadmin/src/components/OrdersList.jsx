import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Text, Pressable } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../theme';
import { FunnelButton, FilterPopup } from './FilterPopup';
import { SearchBar } from './inputs';
import { SkeletonList } from './blocks';
import { FadeInRow } from './motion';
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
const TYPE_CHIPS = [
    { value: '', label: 'Every type' },
    { value: 'delivery', label: 'Delivery' },
    { value: 'pickup', label: 'Pickup' },
    { value: 'dine_in', label: 'Dine-in' },
    { value: 'bulk', label: 'Bulk' },
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
export default function OrdersList({ tenantId, showShop = true, header, search }) {
    const t = useTheme();
    const nav = useNavigation();
    const shops = useShopsStore((s) => s.items);
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [status, setStatus] = useState('active');
    const [range, setRange] = useState('all');
    const [type, setType] = useState('');
    const [shopId, setShopId] = useState(tenantId || '');
    const [picker, setPicker] = useState(false);
    const [filters, setFilters] = useState(false);
    const first = useRef(true);
    const outside = search !== undefined;   // the Orders tab owns the search box and passes its text in
    const word = outside ? String(search).trim() : dq;

    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);
    useEffect(() => { if (!tenantId && !shops.length) useShopsStore.getState().load(); }, [tenantId, shops.length]);

    const params = useMemo(() => ({
        ...(shopId ? { tenantId: shopId } : {}),
        ...(status && !(word && status === 'active') ? { status } : {}),   // typing a search looks in finished orders too
        ...(word ? { q: word } : {}),
        ...(type ? { type } : {}),
        ...(range !== 'all' ? { from: fromOf(range) } : {}),
    }), [shopId, status, word, range, type]);

    const list = usePagedList((page) => listOrders({ ...params, page, limit: 20 }), [params]);

    // back from the detail screen: the status may have changed
    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    const shopName = shops.find((s) => s._id === shopId)?.name;
    const filtered = !!(word || type || status !== 'active' || range !== 'all' || (!tenantId && shopId));
    // the filters that differ from what the list opens with ("In progress", any type, any time, all shops)
    const activeCount = (status !== 'active' ? 1 : 0) + (type ? 1 : 0) + (range !== 'all' ? 1 : 0) + (!tenantId && shopId ? 1 : 0);
    const summary = [
        STATUS_CHIPS.find((c) => c.value === status)?.label || 'All',
        type ? TYPE_CHIPS.find((c) => c.value === type)?.label : null,
        range !== 'all' ? DATE_CHIPS.find((c) => c.value === range)?.label : null,
        !tenantId && shopId ? (shopName || 'One shop') : null,
    ].filter(Boolean).join(' · ');
    const clearFilters = () => { setStatus('active'); setType(''); setRange('all'); if (!tenantId) setShopId(''); };
    const sections = [
        { key: 'status', title: 'Status', options: STATUS_CHIPS.map((c) => [c.value, c.label]), value: status, onChange: setStatus },
        { key: 'type', title: 'Order type', options: TYPE_CHIPS.map((c) => [c.value, c.label]), value: type, onChange: setType },
        { key: 'when', title: 'When', options: DATE_CHIPS.map((c) => [c.value, c.label]), value: range, onChange: setRange },
        ...(!tenantId ? [{ key: 'shop', title: 'Shop', row: shopId ? (shopName || 'One shop') : 'All shops', active: !!shopId, onPress: () => { setFilters(false); setTimeout(() => setPicker(true), 250); } }] : []),
    ];

    return (
        <View style={{ flex: 1 }}>
            {header}
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
                {outside ? <View style={{ flex: 1 }} /> : (
                    <View style={{ flex: 1, marginRight: spacing.md }}>
                        <SearchBar value={q} onChangeText={setQ} placeholder="Search every order" />
                    </View>
                )}
                <FunnelButton count={activeCount} onPress={() => setFilters(true)} />
            </View>
            <Text style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 2, color: activeCount ? t.primary : t.muted, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>{summary}</Text>

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
                    renderItem={({ item, index }) => (
                        <FadeInRow index={index}>
                            <OrderRow order={item} showShop={showShop && !tenantId} onPress={() => nav.navigate('OrderDetail', { orderId: item.id, orderNo: item.orderNo })} />
                        </FadeInRow>
                    )}
                />
            )}

            <FilterPopup visible={filters} onClose={() => setFilters(false)} title="Filter orders" sections={sections} activeCount={activeCount} onClear={clearFilters} />
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
