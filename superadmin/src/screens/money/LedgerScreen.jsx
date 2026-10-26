import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Chip, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, toast } from '../../components/feedback';
import usePagedList from '../../hooks/usePagedList';
import { platformLedger, shopLedger, shareLedgerExcel } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateTime } from '../../utils/format';

const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const RANGES = [
    { value: 'all', label: 'All time' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
];
const CATS = {
    platform: [{ value: '', label: 'Everything' }, { value: 'rent', label: 'Monthly bills' }, { value: 'sms_topup', label: 'SMS top-ups' }],
    shop: [
        { value: '', label: 'Everything' }, { value: 'customer_payment', label: 'From customers' }, { value: 'customer_refund', label: 'Refunds' },
        { value: 'dispute_lost', label: 'Chargebacks' }, { value: 'sms_topup', label: 'SMS top-ups' }, { value: 'rent', label: 'Monthly bills' },
    ],
};

// Every money movement. Platform view: what you received from all shops. Shop view: everything of one shop.
export default function LedgerScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params || {};
    const view = shopId ? 'shop' : 'platform';
    const [category, setCategory] = useState('');
    const [status, setStatus] = useState('');
    const [range, setRange] = useState('30');
    const [busy, setBusy] = useState(false);
    const [totals, setTotals] = useState(null);

    const query = useMemo(() => ({
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(range !== 'all' ? { from: ymd(new Date(Date.now() - Number(range) * 86400000)), to: ymd(new Date()) } : {}),
    }), [category, status, range]);

    const list = usePagedList(async (page) => {
        const r = await (shopId ? shopLedger(shopId, { ...query, page, limit: 20 }) : platformLedger({ ...query, page, limit: 20 }));
        if (page === 1) setTotals(r.totals);
        return { items: r.items, total: r.total, limit: r.limit, page: r.page };
    }, [query, shopId]);

    const exportExcel = async () => {
        setBusy(true);
        try { await shareLedgerExcel(shopId, query); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not export'), 'error'); } finally { setBusy(false); }
    };

    const header = (
        <View>
            {totals ? (
                <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                    <Card style={{ flex: 1 }}>
                        <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>{view === 'shop' ? 'Money in' : 'Received'}</Text>
                        <Text style={{ color: t.success, fontSize: font.lg + 2, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{rupeesFromPaise(totals.inPaise)}</Text>
                    </Card>
                    {view === 'shop' ? (
                        <Card style={{ flex: 1 }}>
                            <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>Money out</Text>
                            <Text style={{ color: t.danger, fontSize: font.lg + 2, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{rupeesFromPaise(totals.outPaise)}</Text>
                        </Card>
                    ) : null}
                    <Card style={{ flex: 1 }}>
                        <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>Pending</Text>
                        <Text style={{ color: t.warn, fontSize: font.lg + 2, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{rupeesFromPaise(totals.pending?.paise)}</Text>
                        <Text style={{ color: t.muted, fontSize: 10 }}>{totals.pending?.count || 0} items</Text>
                    </Card>
                </View>
            ) : null}
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {CATS[view].map((c) => <Chip key={c.label} label={c.label} active={category === c.value} onPress={() => setCategory(c.value)} />)}
                </ScrollView>
            </View>
            <View style={{ height: 48 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {RANGES.map((c) => <Chip key={c.value} label={c.label} active={range === c.value} onPress={() => setRange(c.value)} />)}
                    <Chip label="Done only" active={status === 'done'} icon="ok" onPress={() => setStatus(status === 'done' ? '' : 'done')} />
                    <Chip label="Pending only" active={status === 'pending'} icon="clock" onPress={() => setStatus(status === 'pending' ? '' : 'pending')} />
                </ScrollView>
            </View>
        </View>
    );

    return (
        <Screen
            title="Transactions"
            subtitle={name || 'All shops'}
            scroll={false}
            right={<HeaderButton icon="receipt" onPress={busy ? undefined : exportExcel} />}
        >
            {list.state === 'loading' ? <View>{header}<SkeletonList avatar={false} /></View> : list.state === 'error' ? <View>{header}<ErrorBox message={list.error} onRetry={list.reload} /></View> : (
                <FlatList
                    ListHeaderComponent={header}
                    data={list.items}
                    keyExtractor={(i) => String(i.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="wallet" title="No transactions" hint="Money movements for these filters appear here." />}
                    renderItem={({ item: m }) => (
                        <Card style={{ marginBottom: spacing.sm, marginTop: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flex: 1, paddingRight: spacing.md }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{m.label}</Text>
                                    {m.shop?.name ? <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm }} numberOfLines={1}>{m.shop.name}</Text> : null}
                                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>
                                        {dateTime(m.at)}{m.orderNo ? ` · order #${m.orderNo}` : ''}{m.ref ? ` · ${m.ref}` : ''}
                                    </Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ color: m.direction === 'in' ? t.success : t.danger, fontWeight: '800', fontSize: font.md }}>
                                        {m.direction === 'in' ? '+' : '−'} {rupeesFromPaise(m.amountPaise)}
                                    </Text>
                                    <View style={{ marginTop: 4 }}><Badge label={m.status === 'pending' ? 'Pending' : 'Done'} tone={m.status === 'pending' ? 'warn' : 'success'} /></View>
                                </View>
                            </View>
                        </Card>
                    )}
                />
            )}
        </Screen>
    );
}
