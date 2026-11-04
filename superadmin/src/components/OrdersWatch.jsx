import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../theme';
import { Card, Chip } from './ui';
import { StatStrip, SkeletonList } from './blocks';
import { Empty, ErrorBox } from './feedback';
import { OrderRow } from './orderBits';
import Icon from './Icon';
import { rupees } from '../utils/format';
import { getAttention, getLive } from '../api/ordersApi';

// minutes as "12 min" or "2 h 5 m"
const span = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} m`);

// loads on focus, pull to refresh, and again every 30 seconds while the screen is open
function useWatch(fetcher) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const live = useRef(true);
    const load = useCallback(async () => {
        try { const d = await fetcher(); if (live.current) { setData(d); setError(''); } } catch (e) { if (live.current) setError(e?.message || 'Could not load'); }
    }, [fetcher]);
    useFocusEffect(useCallback(() => {
        live.current = true; load();
        const id = setInterval(load, 30000);
        return () => { live.current = false; clearInterval(id); };
    }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
    return { data, error, load, refresh, refreshing };
}

const CODE_ICON = {
    refund_due: 'rupee', no_rider: 'rider', not_accepted: 'bell', cancel_asked: 'block',
    on_way_long: 'clock', cooking_long: 'clock', payment_failed: 'warning', payment_pending: 'warning',
};
const FILTERS = [
    { value: '', label: 'All' },
    { value: 'refund_due', label: 'Refund due' },
    { value: 'no_rider', label: 'No rider' },
    { value: 'not_accepted', label: 'Not accepted' },
    { value: 'cancel_asked', label: 'Cancel asked' },
    { value: 'on_way_long', label: 'Late delivery' },
    { value: 'cooking_long', label: 'Slow kitchen' },
    { value: 'payment_failed', label: 'Pay failed' },
    { value: 'payment_pending', label: 'Pay pending' },
];

// Orders in trouble, most urgent first, each with the reason and how long it has been so.
export function AttentionList({ header }) {
    const t = useTheme();
    const nav = useNavigation();
    const { data, error, load, refresh, refreshing } = useWatch(getAttention);
    const [code, setCode] = useState('');
    useEffect(() => { if (data && code && !data.counts[code]) setCode(''); }, [data, code]);

    if (!data) return <View style={{ flex: 1 }}>{header}{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />}</View>;
    const items = code ? data.items.filter((i) => i.code === code) : data.items;
    const chips = FILTERS.filter((f) => !f.value || data.counts[f.value]);
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
            {header}
            {data.refundsOpen ? (
                <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                    <Card onPress={() => nav.navigate('Refunds')}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="rupee" size={18} color={t.warn} />
                            <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, marginLeft: spacing.sm }}>{data.refundsOpen} refund{data.refundsOpen > 1 ? 's' : ''} not finished</Text>
                            <Icon name="next" size={16} color={t.muted} />
                        </View>
                    </Card>
                </View>
            ) : null}
            {chips.length > 1 ? (
                <View style={{ height: 52, marginTop: spacing.sm }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                        {chips.map((c) => <Chip key={c.label} label={c.value ? `${c.label} · ${data.counts[c.value]}` : `All · ${data.counts.total || 0}`} active={code === c.value} onPress={() => setCode(c.value)} />)}
                    </ScrollView>
                </View>
            ) : null}
            <View style={{ padding: spacing.lg, paddingTop: spacing.sm }}>
                {!items.length ? (
                    <Empty icon="ok" title="All clear" hint="No order is stuck. This list checks itself every 30 seconds." />
                ) : items.map((it) => (
                    <View key={it.order.id + it.code} style={{ marginBottom: spacing.md }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 }}>
                            <Icon name={CODE_ICON[it.code] || 'warning'} size={15} color={it.code === 'refund_due' || it.code === 'no_rider' ? t.danger : t.warn} />
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.sm, marginLeft: 6, flex: 1 }} numberOfLines={1}>{it.label}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>{span(it.minutes)}</Text>
                        </View>
                        <OrderRow order={it.order} onPress={() => nav.navigate('OrderDetail', { orderId: it.order.id, orderNo: it.order.orderNo })} />
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

// Today's totals and every shop with orders running right now (the one waiting longest first).
export function LiveBoard({ header }) {
    const t = useTheme();
    const nav = useNavigation();
    const { data, error, load, refresh, refreshing } = useWatch(getLive);
    if (!data) return <View style={{ flex: 1 }}>{header}{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />}</View>;
    const tod = data.today;
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
            {header}
            <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
                <StatStrip items={[
                    { label: 'Running now', value: data.running, section: 'orders' },
                    { label: 'Orders today', value: tod.orders, section: 'orders' },
                    { label: 'Delivered', value: tod.delivered, section: 'orders' },
                    { label: 'Cancelled', value: tod.cancelled, section: 'orders' },
                ]} />
                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm, marginLeft: 4 }}>Sales today (delivered): {rupees(tod.sales)}</Text>
            </View>
            <View style={{ padding: spacing.lg }}>
                {!data.shops.length ? <Empty icon="orders" title="Nothing running" hint="Shops with orders in progress show here." /> : data.shops.map((s) => {
                    const slow = s.oldestMin >= 30;
                    return (
                        <Card key={s.tenantId} onPress={() => nav.navigate('ShopOrders', { shopId: s.tenantId, name: s.shopName })} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{s.shopName}</Text>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{s.total}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                                {[['New', s.placed], ['Kitchen', s.kitchen], ['Ready', s.ready], ['On the way', s.onWay]].map(([l, n]) => (
                                    <View key={l} style={{ marginRight: spacing.lg }}>
                                        <Text style={{ color: n ? t.text : t.muted, fontWeight: '800', fontSize: font.md }}>{n}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.xs }}>{l}</Text>
                                    </View>
                                ))}
                            </View>
                            <Text style={{ color: slow ? t.danger : t.muted, fontSize: font.xs, fontWeight: '700', marginTop: spacing.sm }}>
                                Oldest waiting {span(s.oldestMin)}
                            </Text>
                        </Card>
                    );
                })}
            </View>
        </ScrollView>
    );
}
