import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import { Card, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox } from '../../components/feedback';
import { maskedPhone } from '../../components/orderBits';
import { errMsg } from '../../api/adminClient';
import { getRepeatCancellers } from '../../api/ordersApi';
import { paise, ago } from '../../utils/format';

// Customers who cancel or are not at home again and again. Tap one to open him in his shop (where he can be blocked).
export default function RepeatCancellersScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [days, setDays] = useState('30');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async (d = days) => {
        try { setData(await getRepeatCancellers(Number(d))); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [days]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <Screen title="Customers who cancel a lot" subtitle={data ? `${data.items.length} with ${data.min} or more` : 'Cancelled or not at home'} onRefresh={() => load()}>
            <Segmented value={days} onChange={(v) => { setDays(v); setData(null); load(v); }} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <View style={{ marginTop: spacing.md }}>
                {!data ? (error ? <ErrorBox message={error} onRetry={() => load()} /> : <SkeletonList />)
                    : !data.items.length ? <Empty icon="ok" title="Nobody is doing this" hint={`No customer cancelled or was not at home ${data.min} times in these days.`} />
                    : data.items.map((c) => (
                        <Card key={c.userId} onPress={() => nav.navigate('ShopUserDetail', { shopId: c.tenantId, userId: c.userId, shopName: c.shopName })} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{c.name || 'Customer'} · {maskedPhone(c.phone)}</Text>
                                {c.blocked ? <Badge label="Blocked" tone="danger" /> : <Badge label={`${c.times} times`} tone="warn" />}
                            </View>
                            <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{c.shopName}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                                {c.cancelled} cancelled · {c.noShow} not at home · {c.sharePct}% of his {c.orders} orders
                            </Text>
                            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>
                                Last {ago(c.lastAt)}{c.keptPaise ? ` · the shop kept ${paise(c.keptPaise)}` : ''}
                            </Text>
                        </Card>
                    ))}
            </View>
        </Screen>
    );
}
