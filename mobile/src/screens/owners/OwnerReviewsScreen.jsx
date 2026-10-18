// What customers say: ratings of the food (per dish) and of the delivery. Average, how many of each star, and the comments.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Empty } from '../../components/owners/ui';
import { fetchReviews, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { starText } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

function Summary({ s }) {
    const { text, muted, primary } = useBrand();
    const max = Math.max(1, ...Object.values(s.stars));
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ alignItems: 'center', marginRight: 18 }}>
                    <Text style={{ color: text, fontSize: 38, fontWeight: '900' }}>{s.avg != null ? s.avg.toFixed(1) : '—'}</Text>
                    <Text style={{ color: '#D97706' }}>{s.avg != null ? starText(s.avg) : ''}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{s.count} {s.count === 1 ? tr('rating') : tr('ratings')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                    {[5, 4, 3, 2, 1].map((n) => (
                        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
                            <Text style={{ color: muted, width: 14, fontSize: 12 }}>{n}</Text>
                            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: alpha(muted, 0.2), marginHorizontal: 6 }}>
                                <View style={{ width: `${(s.stars[n] / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: primary }} />
                            </View>
                            <Text style={{ color: muted, width: 26, fontSize: 12, textAlign: 'right' }}>{s.stars[n]}</Text>
                        </View>
                    ))}
                </View>
            </View>
        </Card>
    );
}

export default function OwnerReviewsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [kind, setKind] = useState('dish');
    const [rating, setRating] = useState('');
    const [data, setData] = useState(null);     // first page (has the summary)
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchReviews({ kind, page: p, ...(rating ? { rating } : {}) });
            if (p === 1) setData(r);
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load the reviews.')); setItems((x) => x || []); }
    }, [kind, rating]);
    useEffect(() => { setItems(null); load(1); }, [load]);

    const sum = data?.summary?.[kind];

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Reviews')} />
            <FlatList
                data={items || []}
                keyExtractor={(r) => String(r.id)}
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={(
                    <View>
                        <View style={{ paddingHorizontal: 16 }}>
                            <Chips options={[['dish', tr('Food')], ['delivery', tr('Delivery')]]} value={kind} onChange={(k) => { setKind(k); setRating(''); setData(null); }} style={{ marginTop: 0 }} />
                        </View>
                        {sum ? <Summary s={sum} /> : null}
                        <View style={{ paddingHorizontal: 16 }}>
                            <Chips options={[['', tr('All')], ['5', '5 ★'], ['4', '4 ★'], ['3', '3 ★'], ['2', '2 ★'], ['1', '1 ★']]} value={rating} onChange={setRating} style={{ marginTop: 0 }} />
                        </View>
                    </View>
                )}
                renderItem={({ item: r }) => (
                    <Card onPress={r.orderId ? () => nav.navigate('OwnerOrder', { id: String(r.orderId) }) : undefined}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: '#D97706', fontSize: 16 }}>{starText(r.rating)}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginLeft: 'auto' }}>{ago(r.createdAt)}</Text>
                        </View>
                        {r.item ? <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{r.item}</Text> : null}
                        {r.comment ? <Text style={{ color: text, marginTop: 4 }}>“{r.comment}”</Text> : null}
                        {r.tags?.length ? <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{r.tags.map((t) => String(t).replace(/_/g, ' ')).join(' · ')}</Text> : null}
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('{customer} · order #{orderNo}', { customer: r.customer, orderNo: r.orderNo })}</Text>
                    </Card>
                )}
                ListEmptyComponent={items === null ? <ListShimmer /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="star-outline" title={tr('No reviews yet')} hint={tr('Customers can rate dishes and delivery after an order is delivered.')} />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Show more')}</Text></Pressable> : null}
            />
        </View>
    );
}
