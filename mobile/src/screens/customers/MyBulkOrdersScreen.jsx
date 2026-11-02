// The bulk orders this customer asked for, newest first. Tap one to see the shop's quote.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import useBulkLive from '../../hooks/common/useBulkLive';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Empty, Button } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { rs } from '../../components/customers/orders';
import { fetchMyBulk } from '../../api/customers/shopApi';
import { BULK_STATUS, bulkTone, whenText } from './BulkOrderDetailScreen';
import { tr } from '../../i18n';

export default function MyBulkOrdersScreen() {
    const nav = useNavigation();
    const brand = useBrand();
    const { background, text, muted } = brand;
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => { fetchMyBulk().then((r) => { setItems(r.items || []); setErr(''); }).catch((e) => { setErr(e?.response?.data?.error || tr('Could not load')); setItems((x) => x || []); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useBulkLive(load);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My bulk orders')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="cube-outline" title={tr('No bulk orders yet')} hint={tr('Ask a shop for a large order, like an office lunch or a function.')} /> : null}
                {(items || []).map((o) => (
                    <Card key={o.id} onPress={() => nav.navigate('BulkOrderDetail', { id: o.id })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16 }}>{o.code}</Text>
                            <Pill label={tr(BULK_STATUS[o.status] || o.status)} color={bulkTone(o.status, brand)} />
                        </View>
                        <Text style={{ color: muted, marginTop: 4 }}>{o.fulfilment === 'delivery' ? tr('Delivery') : tr('Pickup')} · {whenText(o.when)}</Text>
                        <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{o.quote?.pricing ? `${tr('Quote')} ${rs(o.quote.pricing.total)}` : `${tr('Estimate')} ${rs(o.pricing?.total)}`}</Text>
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                    <Button label={tr('New bulk order')} icon="add" onPress={() => nav.navigate('BulkOrder')} />
                </View>
            </ScrollView>
        </View>
    );
}
