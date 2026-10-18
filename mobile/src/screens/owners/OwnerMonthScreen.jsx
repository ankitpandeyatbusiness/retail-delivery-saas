// One month of transactions: totals, a filter (received, refunds, SMS, bills), every entry, and downloads.
// A monthly bill opens its PDF; an order payment or refund opens the order. Opened with params { month: '2026-10' }.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Stat, Empty, Button, Pill } from '../../components/owners/ui';
import { fetchTransactions, transactionsCsvPath, rentInvoicePdfPath, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees } from '../../utils/owners/riderRules';
import { MOVES, monthName, monthRange } from '../../utils/owners/moneyRules';
import { downloadAndOpen } from '../../utils/owners/files';
import { dayTime } from '../../utils/owners/orderFlow';
import { showToast } from '../../components/customers/shop';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerMonthScreen() {
    const nav = useNavigation();
    const { month } = useRoute().params || {};
    const { background, text, muted, ok, error, primary, border } = useBrand();
    const [cat, setCat] = useState('');
    const [data, setData] = useState(null);
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(null);
    const range = monthRange(month);

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchTransactions({ ...range, ...(cat ? { category: cat } : {}), page: p, limit: 30 });
            if (p === 1) setData(r);
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(r.page * r.limit < r.total); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load this month.')); setItems((x) => x || []); }
    }, [month, cat]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { setItems(null); load(1); }, [load]);

    const csv = async () => {
        setBusy('csv');
        try { await downloadAndOpen({ path: transactionsCsvPath, params: { ...range, ...(cat ? { category: cat } : {}), format: 'csv' }, filename: `transactions-${month}.csv`, mime: 'text/csv', title: monthName(month) }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not download')); } finally { setBusy(null); }
    };
    const bill = async (t) => {
        setBusy(String(t.id));
        try { await downloadAndOpen({ path: rentInvoicePdfPath(t.id), filename: `bill-${String(t.ref || t.id).replace(/\W+/g, '-')}.pdf`, mime: 'application/pdf', title: String(t.ref || 'Bill') }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not open the bill')); } finally { setBusy(null); }
    };
    const open = (t) => {
        if (t.category === 'rent') bill(t);
        else if (t.orderId) nav.navigate('OwnerOrder', { id: String(t.orderId) });
    };

    const tot = data?.totals;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={monthName(month)} />
            <FlatList
                data={items || []}
                keyExtractor={(t) => `${t.category}-${t.id}`}
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={(
                    <View>
                        {tot ? (
                            <Card>
                                <View style={{ flexDirection: 'row' }}>
                                    <Stat label={tr('Money in')} value={rupees(tot.inPaise)} color={ok} />
                                    <Stat label={tr('Money out')} value={rupees(tot.outPaise)} />
                                    <Stat label={tr('Kept')} value={rupees(tot.netPaise)} />
                                </View>
                                {tot.pending.paise ? <Text style={{ color: error, fontSize: 12, marginTop: 8 }}>{tr('{rupees} of bills still to pay', { rupees: rupees(tot.pending.paise) })}</Text> : null}
                            </Card>
                        ) : null}
                        <View style={{ paddingHorizontal: 16 }}><Chips options={MOVES} value={cat} onChange={setCat} style={{ marginTop: 0 }} /></View>
                    </View>
                )}
                renderItem={({ item: t }) => {
                    const tappable = t.category === 'rent' || !!t.orderId;
                    return (
                        <Pressable onPress={tappable ? () => open(t) : undefined} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: border, opacity: pressed && tappable ? 0.7 : 1 })}>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                                <Text style={{ color: text, fontWeight: '800' }} numberOfLines={1}>{t.label}{t.orderNo ? ` · #${t.orderNo}` : ''}{t.category === 'rent' && t.ref ? ` · ${t.ref}` : ''}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{dayTime(t.at)}{t.category === 'rent' ? tr(' · tap to open the bill') : ''}</Text>
                            </View>
                            {t.status === 'pending' ? <Pill label={tr('To pay')} color={error} /> : null}
                            {busy === String(t.id) ? <LineShimmer width={64} height={16} /> : (
                                <Text style={{ color: t.status === 'pending' ? muted : t.direction === 'in' ? ok : text, fontWeight: '900', marginLeft: 8 }}>{t.direction === 'in' ? '+' : '−'}{rupees(t.amountPaise)}</Text>
                            )}
                            {tappable ? <Ionicons name={t.category === 'rent' ? 'document-text-outline' : 'chevron-forward'} size={18} color={muted} style={{ marginLeft: 8 }} /> : null}
                        </Pressable>
                    );
                }}
                ListEmptyComponent={items === null ? <ListShimmer /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="swap-vertical-outline" title={tr('Nothing here')} hint={tr('No entries of this kind in this month.')} />}
                ListFooterComponent={(
                    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                        {more ? <View style={{ marginBottom: 10 }}><Button label={tr('Show more')} kind="ghost" onPress={() => load(page + 1)} /></View> : null}
                        {items && items.length ? <Button label={tr('Download this month (spreadsheet)')} icon="download" kind="ghost" working={busy === 'csv'} disabled={busy === 'csv'} onPress={csv} /> : null}
                    </View>
                )}
            />
        </View>
    );
}
