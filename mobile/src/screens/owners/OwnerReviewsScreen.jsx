// What customers say: ratings of the food (per dish) and of the delivery. Average, how many of each star, and the comments.
import React, { useCallback, useEffect, useState } from 'react';
import { FilterBar } from '../../components/owners/FilterPopup';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Empty } from '../../components/owners/ui';
import { fetchReviews, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { starText } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';
import { Ionicons } from '@expo/vector-icons';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Hero } from '../../components/owners/RiderDesk';
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
    const desk = useOwnerDesktop();   // a computer: a banner with the average and the star bars, star chips, and the reviews as cards two across
    const gcols = useGridCols(2, 420);   // fewer, wider cards in a narrow window
    const nav = useNavigation();
    const { background, text, muted, primary, surface, border } = useBrand();
    const [kind, setKind] = useState('dish');
    const [rating, setRating] = useState('');
    const [data, setData] = useState(null);     // first page (has the summary)
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [fetching, setFetching] = useState(false);   // a computer keeps the reviews on screen, a little dimmed, while the other kind or star filter loads

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchReviews({ kind, page: p, ...(rating ? { rating } : {}) });
            if (p === 1) setData(r);
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load the reviews.')); setItems((x) => x || []); }
    }, [kind, rating]);
    useEffect(() => {
        if (!desk) setItems(null);
        setFetching(true);
        load(1).finally(() => setFetching(false));
    }, [load]);   // eslint-disable-line react-hooks/exhaustive-deps

    const sum = data?.summary?.[kind];

    const deskHeader = (
        <View style={{ paddingBottom: 8 }}>
            <Hero icon="star" title={tr('Reviews')} subtitle={tr('What customers say about your food and your delivery.')}
                right={[['dish', tr('Food')], ['delivery', tr('Delivery')]].map(([k, label]) => (
                    <Pressable key={k} onPress={() => { setKind(k); setRating(''); }} style={({ hovered }) => ({ paddingHorizontal: 18, height: 40, borderRadius: 20, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === k ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)', cursor: 'pointer' })}>
                        <Text style={{ color: kind === k ? primary : '#FFFFFF', fontWeight: '900', fontSize: 14 }}>{label}</Text>
                    </Pressable>
                ))}>
                {sum ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20 }}>
                        <View style={{ alignItems: 'center', paddingHorizontal: 34, paddingVertical: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', marginRight: 14 }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 52, fontWeight: '900', letterSpacing: -1.5 }}>{sum.avg != null ? sum.avg.toFixed(1) : '—'}</Text>
                            <Text style={{ color: '#FDE68A', fontSize: 16, marginTop: 2 }}>{sum.avg != null ? starText(sum.avg) : ''}</Text>
                            <Text style={{ color: '#FFFFFF', opacity: 0.85, fontSize: 12.5, fontWeight: '700', marginTop: 4 }}>{sum.count} {sum.count === 1 ? tr('rating') : tr('ratings')}</Text>
                        </View>
                        <View style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)' }}>
                            {[5, 4, 3, 2, 1].map((n) => {
                                const mx = Math.max(1, ...Object.values(sum.stars));
                                return (
                                    <View key={n} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 3 }}>
                                        <Text style={{ color: '#FFFFFF', width: 16, fontSize: 13, fontWeight: '800' }}>{n}</Text>
                                        <Ionicons name="star" size={12} color="#FDE68A" />
                                        <View style={{ flex: 1, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 10 }}>
                                            <View style={{ width: `${(sum.stars[n] / mx) * 100}%`, height: 9, borderRadius: 5, backgroundColor: '#FFFFFF' }} />
                                        </View>
                                        <Text style={{ color: '#FFFFFF', width: 34, fontSize: 13, fontWeight: '800', textAlign: 'right' }}>{sum.stars[n]}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                ) : null}
            </Hero>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 }}>
                {[['', tr('All ratings')], ['5', '5 ★'], ['4', '4 ★'], ['3', '3 ★'], ['2', '2 ★'], ['1', '1 ★']].map(([k, label]) => (
                    <Pressable key={k || 'all'} onPress={() => setRating(k)} style={({ hovered }) => ({ paddingHorizontal: 16, height: 38, borderRadius: 19, marginRight: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderColor: rating === k ? primary : hovered ? primary + '8C' : border, backgroundColor: rating === k ? primary : hovered ? primary + '12' : 'transparent', cursor: 'pointer' })}>
                        <Text style={{ color: rating === k ? '#FFFFFF' : text, fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Reviews')} />
            <View style={desk ? { flex: 1, width: '100%', maxWidth: 1240, alignSelf: 'center', opacity: fetching ? 0.55 : 1, transitionProperty: 'opacity', transitionDuration: '160ms' } : { flex: 1 }}>
            <FlatList
                key={desk ? `g${gcols}` : 'g1'}
                numColumns={desk ? gcols : 1}
                data={items || []}
                keyExtractor={(r) => String(r.id)}
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={desk ? deskHeader : (
                    <View>
                        <View style={{ paddingHorizontal: 16 }}>
                            <Chips options={[['dish', tr('Food')], ['delivery', tr('Delivery')]]} value={kind} onChange={(k) => { setKind(k); setRating(''); setData(null); }} style={{ marginTop: 0 }} />
                        </View>
                        {sum ? <Summary s={sum} /> : null}
                        <FilterBar title={tr('Filter reviews')} summary={rating ? `${rating} ★` : tr('All ratings')} activeCount={rating ? 1 : 0} onClear={() => setRating('')}
                            sections={[{ key: 'stars', title: tr('Stars'), options: [['', 'All'], ['5', '5 ★'], ['4', '4 ★'], ['3', '3 ★'], ['2', '2 ★'], ['1', '1 ★']], value: rating, onChange: setRating }]} />
                    </View>
                )}
                renderItem={({ item: r }) => desk ? (
                    <View style={{ width: `${100 / gcols}%`, padding: 8 }}>
                        <Pressable onPress={r.orderId ? () => nav.navigate('OwnerOrder', { id: String(r.orderId) }) : undefined} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered && r.orderId ? primary : border, backgroundColor: hovered && r.orderId ? primary + '0D' : surface, padding: 20, cursor: r.orderId ? 'pointer' : 'default', boxShadow: hovered && r.orderId ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: primary + '24', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: primary, fontWeight: '900', fontSize: 17 }}>{String(r.customer || '?').trim().charAt(0).toUpperCase() || '?'}</Text></View>
                                <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>{r.customer}</Text>
                                    <Text style={{ color: muted, fontSize: 12.5 }}>{tr('order #{orderNo}', { orderNo: r.orderNo })} · {ago(r.createdAt)}</Text>
                                </View>
                                <Text style={{ color: '#D97706', fontSize: 17 }}>{starText(r.rating)}</Text>
                            </View>
                            {r.item ? <View style={{ alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: primary + '1F', justifyContent: 'center' }}><Text style={{ color: primary, fontWeight: '800', fontSize: 12.5 }}>{r.item}</Text></View> : null}
                            {r.comment ? <Text style={{ color: text, marginTop: 12, fontSize: 15, lineHeight: 22 }}>“{r.comment}”</Text> : null}
                            {r.tags?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>{r.tags.map((t) => <View key={String(t)} style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: muted + '22', justifyContent: 'center', marginRight: 6, marginBottom: 4 }}><Text style={{ color: muted, fontSize: 11.5, fontWeight: '700' }}>{String(t).replace(/_/g, ' ')}</Text></View>)}</View> : null}
                        </Pressable>
                    </View>
                ) : (
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
        </View>
    );
}
