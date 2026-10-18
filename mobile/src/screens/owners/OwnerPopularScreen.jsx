// Popular items: what customers order most, for the last 7 days, 30 days or 3 months (delivered orders only).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Empty, money } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchSalesReport, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { periodRange } from '../../utils/owners/moneyRules';
import { tr } from '../../i18n';

const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months']];

export default function OwnerPopularScreen() {
    const { background, text, muted, primary, ok } = useBrand();
    const [range, setRange] = useState('7');
    const [items, setItems] = useState(null);
    const [orders, setOrders] = useState(0);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setItems(null); setErr('');
        try {
            // periodRange knows 7 / 30 / today / month; 3 months is 90 days
            const r = range === '90'
                ? { from: new Date(Date.now() + 330 * 60000 - 89 * 86400000).toISOString().slice(0, 10), to: periodRange('today').to }
                : periodRange(range);
            const x = await fetchSalesReport({ ...r, groupBy: 'month', topLimit: 30 });
            setItems(x.topItems || []); setOrders(x.totals.orders);
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load.')); setItems([]); }
    }, [range]);
    useEffect(() => { load(); }, [load]);

    const max = Math.max(1, ...(items || []).map((i) => i.quantity));
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Popular items')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                <View style={{ paddingHorizontal: 16 }}><Chips options={RANGES} value={range} onChange={setRange} style={{ marginTop: 0 }} /></View>
                {items === null ? <ListShimmer rows count={6} /> : null}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !err && !items.length ? <Empty icon="trophy-outline" title={tr('No sales in this period')} hint={tr('Delivered orders are counted here.')} /> : null}
                {items && items.length ? (
                    <>
                        <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 8 }}>{tr('From {orders} delivered {v2}. Most sold first.', { orders: orders, v2: orders === 1 ? 'order' : 'orders' })}</Text>
                        <Card>
                            {items.map((it, i) => (
                                <View key={String(it.productId)} style={{ paddingVertical: 10, borderBottomWidth: i === items.length - 1 ? 0 : 0.5, borderBottomColor: alpha(muted, 0.4) }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ width: 26, color: i < 3 ? primary : muted, fontWeight: '900' }}>{i + 1}</Text>
                                        <Text style={{ flex: 1, color: text, fontWeight: '800' }} numberOfLines={1}>{it.name}</Text>
                                        <Text style={{ color: text, fontWeight: '900' }}>{it.quantity}</Text>
                                        <Text style={{ color: muted, fontSize: 12, marginLeft: 4 }}>{tr('sold')}</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 26 }}>
                                        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: alpha(muted, 0.18) }}>
                                            <View style={{ width: `${(it.quantity / max) * 100}%`, height: 6, borderRadius: 3, backgroundColor: i < 3 ? primary : alpha(primary, 0.5) }} />
                                        </View>
                                        <Text style={{ color: ok, fontWeight: '800', fontSize: 12, marginLeft: 10 }}>{money(it.revenue)}</Text>
                                    </View>
                                </View>
                            ))}
                        </Card>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
