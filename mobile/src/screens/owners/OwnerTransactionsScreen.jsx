// Transactions and bills: pick a year, see every month with what came in, what went out and what you kept. Tap a month for
// its payments, refunds, SMS top-ups and bills (and to download them).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Stat, Empty, Button } from '../../components/owners/ui';
import { fetchTransactionSummary, transactionsCsvPath, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees } from '../../utils/owners/riderRules';
import { monthName } from '../../utils/owners/moneyRules';
import { downloadAndOpen } from '../../utils/owners/files';
import { showToast } from '../../components/customers/shop';
import { StatShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerTransactionsScreen() {
    const nav = useNavigation();
    const { background, text, muted, ok, error, primary, border } = useBrand();
    const [year, setYear] = useState(undefined);
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (y) => {
        setData(null); setErr('');
        try { setData(await fetchTransactionSummary(y)); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your transactions.')); }
    }, []);
    useEffect(() => { load(year); }, [year, load]);

    const csv = async () => {
        if (!data) return;
        setBusy(true);
        try { await downloadAndOpen({ path: transactionsCsvPath, params: { from: `${data.year}-01-01`, to: `${data.year}-12-31`, format: 'csv' }, filename: `transactions-${data.year}.csv`, mime: 'text/csv', title: `Transactions ${data.year}` }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not download')); } finally { setBusy(false); }
    };

    const months = data ? data.months.filter((m) => m.count > 0 || m.pendingPaise > 0) : [];

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Transactions and bills')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {data && data.years.length > 1 ? (
                    <View style={{ paddingHorizontal: 16 }}>
                        <Chips options={data.years.map((y) => [y, String(y)])} value={data.year} onChange={setYear} style={{ marginTop: 0 }} />
                    </View>
                ) : null}
                {!data && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {data ? (
                    <>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{data.year}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                <Stat label={tr('Money in')} value={rupees(data.totals.inPaise)} color={ok} />
                                <Stat label={tr('Money out')} value={rupees(data.totals.outPaise)} />
                                <Stat label={tr('Kept')} value={rupees(data.totals.netPaise)} />
                            </View>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('In: customers\' online payments. Out: refunds, chargebacks, SMS top-ups and your monthly bills.')}</Text>
                        </Card>

                        {!months.length ? <Empty icon="swap-vertical-outline" title={tr('Nothing in this year')} hint={tr('Payments, refunds, top-ups and bills appear here.')} /> : null}
                        {months.map((m) => (
                            <Card key={m.month} onPress={() => nav.navigate('OwnerMonth', { month: m.month })}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{monthName(m.month)}</Text>
                                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{m.count} {m.count === 1 ? tr('entry') : tr('entries')}{m.pendingPaise ? tr(' · {rupees} to pay', { rupees: rupees(m.pendingPaise) }) : ''}</Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                                        <Text style={{ color: ok, fontWeight: '800' }}>+{rupees(m.inPaise)}</Text>
                                        <Text style={{ color: text, fontWeight: '800', marginTop: 2 }}>−{rupees(m.outPaise)}</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color={muted} />
                                </View>
                            </Card>
                        ))}
                        {months.length ? <View style={{ paddingHorizontal: 16 }}><Button label={tr('Excel Sheet')} icon="download" kind="ghost" working={busy} disabled={busy} onPress={csv} /></View> : null}
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
