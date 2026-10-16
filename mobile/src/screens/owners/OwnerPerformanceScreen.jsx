// Rider performance: deliveries, average time from pick-up to door, cash collected and customer rating, for a period.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Empty, Stat } from '../../components/owners/ui';
import { Avatar } from './OwnerRidersScreen';
import { fetchRiderPerformance, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees, rangeOf } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';

export default function OwnerPerformanceScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [range, setRange] = useState('30');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async (id) => {
        setData(null); setError('');
        try { setData(await fetchRiderPerformance(rangeOf(id))); }
        catch (e) { useOwnerStore.getState().noteError(e); setError(apiError(e, 'Could not load the performance.')); setData({ items: [] }); }
    }, []);
    useFocusEffect(useCallback(() => { load(range); }, [load, range]));

    const items = data?.items || [];
    const total = items.reduce((n, r) => n + r.deliveries, 0);
    const cash = items.reduce((n, r) => n + (r.cashCollectedPaise || 0), 0);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Rider performance" />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month']]} value={range} onChange={setRange} style={{ marginTop: 0 }} />
                </View>
                {data === null ? <ListShimmer /> : null}
                {error ? <Empty icon="cloud-offline-outline" title="Could not load" hint={error} /> : null}
                {data && !error ? (
                    <>
                        <Card>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label="Deliveries" value={String(total)} />
                                <Stat label="Cash collected" value={rupees(cash)} />
                            </View>
                        </Card>
                        {!items.length ? <Empty icon="bicycle" title="No deliveries in this period" hint="Delivered orders with a rider show up here." /> : null}
                        {items.map((r, i) => (
                            <Card key={String(r.riderId)} onPress={() => nav.navigate('OwnerRider', { userId: String(r.riderId) })}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: muted, fontWeight: '900', width: 22 }}>{i + 1}</Text>
                                    <Avatar rider={{ name: r.name }} size={38} />
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{r.name}</Text>
                                        <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>
                                            {r.avgDeliveryMin != null ? `${Math.round(r.avgDeliveryMin)} min average` : 'No time recorded'}
                                            {r.periodRatingAvg != null ? `  ·  ★ ${r.periodRatingAvg.toFixed(1)} (${r.periodRatedCount})` : ''}
                                        </Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={{ color: primary, fontWeight: '900', fontSize: 20 }}>{r.deliveries}</Text>
                                        <Text style={{ color: muted, fontSize: 11 }}>deliveries</Text>
                                    </View>
                                </View>
                            </Card>
                        ))}
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
