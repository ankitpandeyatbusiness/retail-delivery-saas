import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import { Card, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox } from '../../components/feedback';
import { errMsg } from '../../api/adminClient';
import { getShopQuality } from '../../api/ordersApi';
import { rupees } from '../../utils/format';

// Which shops need a talk: too many cancels by the shop, slow kitchen, slow delivery, many complaints.
export default function ShopQualityScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [days, setDays] = useState('30');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async (d = days) => {
        try { setData(await getShopQuality(Number(d))); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [days]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const num = (v, unit) => (v == null ? '–' : `${v}${unit}`);
    return (
        <Screen title="Shop quality" subtitle={data ? `${data.weak} need a talk` : 'How each shop is doing'} onRefresh={() => load()}>
            <Segmented value={days} onChange={(v) => { setDays(v); setData(null); load(v); }} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <Card onPress={() => nav.navigate('RepeatCancellers')} style={{ marginTop: spacing.md }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>Customers who cancel a lot</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>Cancelled or not at home 3 times or more</Text>
            </Card>
            <View style={{ marginTop: spacing.md }}>
                {!data ? (error ? <ErrorBox message={error} onRetry={() => load()} /> : <SkeletonList />)
                    : !data.items.length ? <Empty icon="shops" title="No orders in this time" hint="Shops appear here once they get orders." />
                    : data.items.map((s) => (
                        <Card key={s.tenantId} onPress={() => nav.navigate('ShopOrders', { shopId: s.tenantId, name: s.shopName })} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{s.shopName}</Text>
                                <Badge label={s.weak ? 'Needs a talk' : s.orders < (data.minOrders || 10) ? 'Too few orders' : 'Good'} tone={s.weak ? 'danger' : s.orders < (data.minOrders || 10) ? 'neutral' : 'success'} />
                            </View>
                            <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                                {[['Orders', s.orders], ['Sales', rupees(s.sales)], ['Shop cancels', `${s.shopCancelPct}%`], ['Prepare', num(s.prepMin, ' min')], ['Delivery', num(s.deliveryMin, ' min')], ['Complaints', s.complaints]].map(([l, v]) => (
                                    <View key={l} style={{ flex: 1 }}>
                                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>{v}</Text>
                                        <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{l}</Text>
                                    </View>
                                ))}
                            </View>
                            {s.why.map((w) => <Text key={w} style={{ color: t.danger, fontSize: font.xs, fontWeight: '700', marginTop: spacing.sm }}>{w}</Text>)}
                        </Card>
                    ))}
            </View>
        </Screen>
    );
}
