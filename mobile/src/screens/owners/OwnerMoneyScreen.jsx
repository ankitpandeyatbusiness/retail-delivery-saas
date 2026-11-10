// Money tab: how much the shop sold (pick a period), what came in online and the SMS balance.
// Sales are DELIVERED orders only. Sales numbers are rupees; online money, SMS and bills are paise.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Chips, Pill, Empty, money } from '../../components/owners/ui';
import { Bars, MoneyRow } from '../../components/owners/moneyBits';
import { StatShimmer } from '../../components/owners/shimmer';
import { fetchSalesReport, fetchPaymentsReport, fetchSmsWallet, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { periodRange, PERIODS, PAY_LABEL, shortDay } from '../../utils/owners/moneyRules';
import { rupees } from '../../utils/owners/riderRules';
import { downloadAndOpen, XLSX } from '../../utils/owners/files';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function OwnerMoneyScreen({ page = false } = {}) {
    const nav = useNavigation();
    const { muted, text, error, ok, primary } = useBrand();
    const access = useOwnerStore((s) => s.access);
    const [period, setPeriod] = useState('7');
    const [sales, setSales] = useState(null);
    const [salesErr, setSalesErr] = useState('');
    const [online, setOnline] = useState(null);
    const [sms, setSms] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const seq = useRef(0);

    const load = useCallback(async (id) => {
        const mine = ++seq.current;
        const [s, o, w] = await Promise.allSettled([
            fetchSalesReport({ ...periodRange(id), groupBy: 'day' }),
            fetchPaymentsReport(periodRange('30')),
            fetchSmsWallet(),
        ]);
        if (mine !== seq.current) return;
        if (s.status === 'fulfilled') { setSales(s.value); setSalesErr(''); } else { useOwnerStore.getState().noteError(s.reason); setSalesErr(apiError(s.reason, tr('Could not load your sales.'))); }
        if (o.status === 'fulfilled') setOnline(o.value);
        if (w.status === 'fulfilled') setSms(w.value);
    }, []);

    useFocusEffect(useCallback(() => { load(period); }, [load, period]));

    const pick = (id) => { setPeriod(id); setSales(null); };
    const refresh = async () => { setRefreshing(true); await load(period); setRefreshing(false); };

    const exportExcel = async () => {
        setExporting(true);
        try {
            const r = periodRange(period);
            await downloadAndOpen({ path: '/shop/reports/export', params: r, filename: `sales-${r.from}-to-${r.to}.xlsx`, mime: XLSX, title: tr('Sales report') });
        } catch (e) { showToast(e.safe ? e.message : tr('Could not make the Excel file')); } finally { setExporting(false); }
    };

    const t = sales?.totals;
    const series = (sales?.series || []).map((x) => ({ label: x.period, value: x.revenue }));

    return (
        <OwnerScreen title={tr('Money')} onRefresh={refresh} refreshing={refreshing} page={page === true}>

            <View style={{ paddingHorizontal: 16 }}>
                <Chips options={PERIODS} value={period} onChange={pick} style={{ marginTop: 0 }} />
            </View>

            {salesErr && !sales ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={salesErr} /> : null}
            {sales ? (
                <>
                    <Card>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Sales (delivered orders)')}</Text>
                        <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(t.revenue)}</Text>
                        {sales.bulk?.orders > 0 ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <Ionicons name="cube" size={13} color={primary} />
                                <Text style={{ color: primary, fontWeight: '800', fontSize: 12.5, marginLeft: 5 }}>{tr('Includes {n} bulk orders: {amount}', { n: sales.bulk.orders, amount: money(sales.bulk.revenue) })}</Text>
                            </View>
                        ) : null}
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <Stat label={tr('Orders')} value={String(t.orders)} />
                            <Stat label={tr('Average order')} value={money(t.averageOrderValue)} />
                            <Stat label={tr('Not delivered')} value={String(sales.undelivered)} color={sales.undelivered ? error : undefined} />
                        </View>
                        {series.length > 1 ? <View style={{ marginTop: 16 }}><Bars series={series} /></View> : null}
                    </Card>

                    {t.orders ? (
                        <>
                            <SectionTitle title={tr('Where it came from')} />
                            <Card>
                                {sales.payments.map((p, i) => (
                                    <MoneyRow key={p.method} title={PAY_LABEL[p.method] || p.method} note={`${p.orders} ${p.orders === 1 ? 'order' : 'orders'}`} value={money(p.revenue)} last={i === sales.payments.length - 1} />
                                ))}
                            </Card>
                            {sales.topItems.length ? (
                                <>
                                    <SectionTitle title={tr('Best selling items')} action={tr('See all')} onAction={() => nav.navigate('OwnerPopular')} />
                                    <Card>
                                        {sales.topItems.slice(0, 5).map((it, i, a) => (
                                            <MoneyRow key={String(it.productId)} title={it.name} note={tr('{quantity} sold', { quantity: it.quantity })} value={money(it.revenue)} last={i === a.length - 1} />
                                        ))}
                                    </Card>
                                </>
                            ) : null}
                            <SectionTitle title={tr('Also in these orders')} />
                            <Card>
                                <MoneyRow title={tr('Delivery fees')} value={money(t.deliveryFees)} />
                                <MoneyRow title={tr('Tax collected')} value={money(t.tax)} />
                                <MoneyRow title={tr('Tips')} value={money(t.tips)} />
                                <MoneyRow title={tr('Discounts given')} value={money(t.discount)} last />
                            </Card>
                            <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                                <Button label={tr('Download Excel')} icon="download" kind="ghost" working={exporting} disabled={exporting} onPress={exportExcel} />
                            </View>
                        </>
                    ) : <Empty icon="stats-chart-outline" title={tr('No sales in this period')} hint={tr('Delivered orders show up here.')} />}
                </>
            ) : !salesErr ? <StatShimmer /> : null}

            <SectionTitle title={tr('Money in your account')} />
            <Card onPress={() => nav.navigate('OwnerPayments')}>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label={tr('Online received (30 days)')} value={online ? rupees(online.captured.paise) : '—'} />
                    <Stat label={tr('Refunded')} value={online ? rupees(online.refunded.paise) : '—'} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <Text style={{ color: muted, flex: 1, fontSize: 12 }}>
                        {online && (online.refundsOnTheWay.count || online.disputesOpen)
                            ? `${online.refundsOnTheWay.count ? `${online.refundsOnTheWay.count} refunds on the way` : ''}${online.refundsOnTheWay.count && online.disputesOpen ? ' · ' : ''}${online.disputesOpen ? `${online.disputesOpen} chargebacks need a look` : ''}`
                            : tr('Payments, refunds and chargebacks')}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={muted} />
                </View>
            </Card>
        </OwnerScreen>
    );
}

// the Money page of the side menu (rent, SMS balance, top up): a normal page with a back arrow
export const OwnerMoneyPage = () => <OwnerMoneyScreen page />;
