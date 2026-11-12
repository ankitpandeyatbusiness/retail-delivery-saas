// Rider performance: deliveries, average time from pick-up to door, cash collected and customer rating, for a period.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, Tile } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Chips, Empty, Stat } from '../../components/owners/ui';
import { Avatar } from './OwnerRidersScreen';
import { fetchRiderPerformance, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees, rangeOf } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

// a rider on the leaderboard (computer): his rank (a medal for the first three), a bar of his deliveries against the best, his time and his rating
function RankCard({ r, i, max, onOpen }) {
    const gcols = useGridCols(2, 420);
    const { text, muted, surface, border, primary } = useBrand();
    const medal = ['#F59E0B', '#94A3B8', '#B45309'][i];
    return (
        <View style={{ width: `${100 / gcols}%`, padding: 8 }}>
            <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 18, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: medal ? alpha(medal, 0.18) : alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                        {medal ? <Ionicons name="trophy" size={19} color={medal} /> : <Text style={{ color: muted, fontWeight: '900' }}>{i + 1}</Text>}
                    </View>
                    <View style={{ marginLeft: 12 }}><Avatar rider={{ name: r.name }} size={46} /></View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16.5 }} numberOfLines={1}>{r.name}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
                            {r.avgDeliveryMin != null ? tr('{v1} min average', { v1: Math.round(r.avgDeliveryMin) }) : tr('No time recorded')}
                            {r.periodRatingAvg != null ? `  ·  ★ ${r.periodRatingAvg.toFixed(1)} (${r.periodRatedCount})` : ''}
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: primary, fontWeight: '900', fontSize: 26, letterSpacing: -0.5 }}>{r.deliveries}</Text>
                        <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700' }}>{tr('deliveries')}</Text>
                    </View>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(primary, 0.12), marginTop: 14, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(4, (r.deliveries / Math.max(1, max)) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: primary }} />
                </View>
                <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginTop: 8 }}>{tr('Cash collected')}: {rupees(r.cashCollectedPaise || 0)}</Text>
            </Pressable>
        </View>
    );
}

export default function OwnerPerformanceScreen() {
    const desk = useOwnerDesktop();
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [range, setRange] = useState('30');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async (id) => {
        if (!desk) setData(null);
        setError('');
        try { setData(await fetchRiderPerformance(rangeOf(id))); }
        catch (e) { useOwnerStore.getState().noteError(e); setError(apiError(e, 'Could not load the performance.')); setData({ items: [] }); }
    }, []);
    useFocusEffect(useCallback(() => { load(range); }, [load, range]));

    const items = data?.items || [];
    const total = items.reduce((n, r) => n + r.deliveries, 0);
    const cash = items.reduce((n, r) => n + (r.cashCollectedPaise || 0), 0);
    const fastest = items.filter((r) => r.avgDeliveryMin != null).sort((a, b) => a.avgDeliveryMin - b.avgDeliveryMin)[0];
    const best = items.filter((r) => r.periodRatingAvg != null).sort((a, b) => b.periodRatingAvg - a.periodRatingAvg)[0];
    const maxDel = Math.max(1, ...items.map((r) => r.deliveries));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Rider performance')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero icon="stats-chart" title={tr('Rider performance')} subtitle={tr('Deliveries, delivery time, cash and ratings for each rider')}
                        right={[['7', tr('Last 7 days')], ['30', tr('Last 30 days')], ['month', tr('This month')]].map(([id, label]) => (
                            <Pressable key={id} onPress={() => setRange(id)} style={({ hovered }) => ({ paddingHorizontal: 16, height: 40, borderRadius: 20, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: range === id ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)', cursor: 'pointer' })}>
                                <Text style={{ color: range === id ? primary : '#FFFFFF', fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
                            </Pressable>
                        ))} />
                ) : (
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['7', tr('Last 7 days')], ['30', tr('Last 30 days')], ['month', tr('This month')]]} value={range} onChange={setRange} style={{ marginTop: 0 }} />
                </View>
                )}
                {data === null ? <ListShimmer /> : null}
                {error ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
                {data && !error ? (
                    <>
                        {desk ? (
                            <View style={{ flexDirection: 'row', marginHorizontal: 8, marginBottom: 8 }}>
                                <Tile label={tr('Deliveries')} value={String(total)} icon="bicycle" color={primary} />
                                <Tile label={tr('Cash collected')} value={rupees(cash)} icon="cash-outline" color="#10B981" />
                                <Tile label={tr('Fastest on average')} value={fastest ? `${Math.round(fastest.avgDeliveryMin)} min` : '–'} icon="flash-outline" color="#F59E0B" sub={fastest?.name} />
                                <Tile label={tr('Best rated')} value={best ? `★ ${best.periodRatingAvg.toFixed(1)}` : '–'} icon="star-outline" color="#8B5CF6" sub={best?.name} />
                            </View>
                        ) : (
                        <Card>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label={tr('Deliveries')} value={String(total)} />
                                <Stat label={tr('Cash collected')} value={rupees(cash)} />
                            </View>
                        </Card>
                        )}
                        {!items.length ? <Empty icon="bicycle" title={tr('No deliveries in this period')} hint={tr('Delivered orders with a rider show up here.')} /> : null}
                        {desk ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>{items.map((r, i) => <RankCard key={String(r.riderId)} r={r} i={i} max={maxDel} onOpen={() => nav.navigate('OwnerRider', { userId: String(r.riderId) })} />)}</View> : null}
                        {desk ? null : items.map((r, i) => (
                            <Card key={String(r.riderId)} onPress={() => nav.navigate('OwnerRider', { userId: String(r.riderId) })}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: muted, fontWeight: '900', width: 22 }}>{i + 1}</Text>
                                    <Avatar rider={{ name: r.name }} size={38} />
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{r.name}</Text>
                                        <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>
                                            {r.avgDeliveryMin != null ? tr('{v1} min average', { v1: Math.round(r.avgDeliveryMin) }) : tr('No time recorded')}
                                            {r.periodRatingAvg != null ? `  ·  ★ ${r.periodRatingAvg.toFixed(1)} (${r.periodRatedCount})` : ''}
                                        </Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={{ color: primary, fontWeight: '900', fontSize: 20 }}>{r.deliveries}</Text>
                                        <Text style={{ color: muted, fontSize: 11 }}>{tr('deliveries')}</Text>
                                    </View>
                                </View>
                            </Card>
                        ))}
                    </>
                ) : null}
              </Frame>
            </ScrollView>
        </View>
    );
}
