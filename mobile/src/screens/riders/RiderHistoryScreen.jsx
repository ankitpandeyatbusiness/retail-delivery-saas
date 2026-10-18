// Past deliveries, newest first. Plain rows: the order, when, and how it ended. Nothing to tap, nothing to learn.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { BigButton } from '../../components/riders/riderBits';
import { fetchRiderOrders } from '../../api/riders/riderApi';
import { T, rupee, rupeeAmount, errText } from '../../utils/riders/riderText';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default function RiderHistoryScreen() {
    const insets = useSafeAreaInsets();
    const { background, text, muted, surface, border, ok, error } = useBrand();
    const [items, setItems] = useState(null);
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [failed, setFailed] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchRiderOrders('history', p);
            setItems((old) => (p === 1 ? r.items || [] : [...(old || []), ...(r.items || [])]));
            setMore(!!r.hasMore); setPage(p); setFailed('');
        } catch (e) { setFailed(errText(e)); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(1); }, [load]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <Text style={{ color: text, fontSize: 22, fontWeight: '900', paddingHorizontal: 16, paddingTop: insets.top + 14, paddingBottom: 10 }}>{T.history}</Text>
            {items === null ? <View style={{ padding: 40 }}><ActivityIndicator /></View> : (
                <FlatList
                    data={items}
                    keyExtractor={(o) => String(o.id)}
                    contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
                    ListEmptyComponent={(
                        <View style={{ alignItems: 'center', padding: 40 }}>
                            <Ionicons name={failed ? 'cloud-offline-outline' : 'time-outline'} size={48} color={muted} />
                            <Text style={{ color: text, fontWeight: '800', fontSize: 16, marginTop: 10 }}>{failed || T.noHistory}</Text>
                        </View>
                    )}
                    ListFooterComponent={more ? <View style={{ padding: 16 }}><BigButton label="Show more" kind="outline" onPress={() => load(page + 1)} /></View> : null}
                    renderItem={({ item: o }) => {
                        const done = o.status === 'delivered';
                        return (
                            <View style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 16, padding: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>Order #{o.orderNo}</Text>
                                    <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginTop: 2 }}>{when(o.delivery?.deliveredAt || o.createdAt)}</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ color: done ? ok : error, fontWeight: '900', fontSize: 14 }}>{done ? 'Delivered' : o.status === 'cancelled' ? 'Cancelled' : 'Not delivered'}</Text>
                                    {done && o.earnPaise > 0 ? <Text style={{ color: text, fontWeight: '800', fontSize: 13, marginTop: 2 }}>{rupee(o.earnPaise)}</Text> : null}
                                    {done && o.payment?.collectAmount > 0 ? <Text style={{ color: muted, fontWeight: '700', fontSize: 12, marginTop: 2 }}>{rupeeAmount(o.payment.collectAmount)} cash</Text> : null}
                                </View>
                            </View>
                        );
                    }}
                />
            )}
        </View>
    );
}
