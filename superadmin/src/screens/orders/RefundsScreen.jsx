import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import { Card, Button, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, toast } from '../../components/feedback';
import { errMsg } from '../../api/adminClient';
import { listRefunds, retryRefund } from '../../api/ordersApi';
import { paise, ago } from '../../utils/format';

const TONE = { pending: 'warn', processing: 'info', failed: 'danger', processed: 'success' };
const WORD = { pending: 'Waiting to send', processing: 'Sending', failed: 'Failed', processed: 'Done' };

// Online refunds that are not finished (or finished), with a Send again for a failed one.
export default function RefundsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [tab, setTab] = useState('open');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async (which = tab) => {
        try { setData(await listRefunds(which)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [tab]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const again = async (r) => {
        setBusy(r.id);
        try {
            const res = await retryRefund(r.id);
            toast(res.status === 'failed' ? (res.lastError || 'Still failed') : 'Refund sent again', res.status === 'failed' ? 'error' : 'ok');
            await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const failed = data?.open?.failed;
    return (
        <Screen title="Refunds" subtitle="Money going back to customers" onRefresh={() => load()}>
            <Segmented value={tab} onChange={(v) => { setTab(v); setData(null); load(v); }} options={[{ value: 'open', label: 'Not finished' }, { value: 'done', label: 'Done' }]} />
            {failed ? (
                <Text style={{ color: t.danger, fontWeight: '700', fontSize: font.sm, marginTop: spacing.md }}>
                    {failed.count} failed, {paise(failed.paise)} not yet back with the customer. Check the shop's Razorpay balance, then send again.
                </Text>
            ) : null}
            <View style={{ marginTop: spacing.md }}>
                {!data ? (error ? <ErrorBox message={error} onRetry={() => load()} /> : <SkeletonList />)
                    : !data.items.length ? <Empty icon="ok" title={tab === 'open' ? 'No refund waiting' : 'No finished refunds yet'} hint={tab === 'open' ? 'Every refund has reached the customer.' : ''} />
                    : data.items.map((r) => (
                        <Card key={r.id} onPress={() => nav.navigate('OrderDetail', { orderId: r.orderId, orderNo: r.orderNo })} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{paise(r.amountPaise)}</Text>
                                <Badge label={WORD[r.status] || r.status} tone={TONE[r.status]} />
                            </View>
                            <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{r.shopName} · order {r.ref || '#' + r.orderNo}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{r.customer || 'Customer'}{r.reason ? ` · ${r.reason.replace(/_/g, ' ')}` : ''} · {ago(r.processedAt || r.createdAt)}</Text>
                            {r.status === 'failed' && r.lastError ? <Text style={{ color: t.danger, fontSize: font.xs, marginTop: spacing.sm }}>{r.lastError}</Text> : null}
                            {r.status === 'failed' ? <Button title="Send again" icon="next" loading={busy === r.id} onPress={() => again(r)} style={{ marginTop: spacing.md }} /> : null}
                        </Card>
                    ))}
            </View>
        </Screen>
    );
}
