// Money tab: how much the shop sold (pick a period), what came in online, the SMS balance, and the monthly bill.
// Sales are DELIVERED orders only. Sales numbers are rupees; online money, SMS and bills are paise.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Chips, Pill, Empty, money } from '../../components/owners/ui';
import { Bars, MoneyRow } from '../../components/owners/moneyBits';
import { StatShimmer } from '../../components/owners/shimmer';
import { fetchSalesReport, fetchPaymentsReport, fetchSmsWallet, fetchBillingStatus, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { periodRange, PERIODS, PAY_LABEL, shortDay } from '../../utils/owners/moneyRules';
import { rupees } from '../../utils/owners/riderRules';
import { downloadAndOpen, XLSX } from '../../utils/owners/files';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function OwnerMoneyScreen() {
    const nav = useNavigation();
    const { muted, text, error, ok, primary } = useBrand();
    const access = useOwnerStore((s) => s.access);
    const [period, setPeriod] = useState('7');
    const [sales, setSales] = useState(null);
    const [salesErr, setSalesErr] = useState('');
    const [online, setOnline] = useState(null);
    const [sms, setSms] = useState(null);
    const [bill, setBill] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const seq = useRef(0);

    const load = useCallback(async (id) => {
        const mine = ++seq.current;
        const [s, o, w, b] = await Promise.allSettled([
            fetchSalesReport({ ...periodRange(id), groupBy: 'day' }),
            fetchPaymentsReport(periodRange('30')),
            fetchSmsWallet(),
            fetchBillingStatus(),
        ]);
        if (mine !== seq.current) return;
        if (s.status === 'fulfilled') { setSales(s.value); setSalesErr(''); } else { useOwnerStore.getState().noteError(s.reason); setSalesErr(apiError(s.reason, 'Could not load your sales.')); }
        if (o.status === 'fulfilled') setOnline(o.value);
        if (w.status === 'fulfilled') setSms(w.value);
        if (b.status === 'fulfilled') setBill(b.value);
    }, []);

    useFocusEffect(useCallback(() => { load(period); }, [load, period]));

    const pick = (id) => { setPeriod(id); setSales(null); };
    const refresh = async () => { setRefreshing(true); await load(period); setRefreshing(false); };

    const exportExcel = async () => {
        setExporting(true);
        try {
            const r = periodRange(period);
            await downloadAndOpen({ path: '/shop/reports/export', params: r, filename: `sales-${r.from}-to-${r.to}.xlsx`, mime: XLSX, title: 'Sales report' });
        } catch (e) { showToast(e.safe ? e.message : tr('Could not make the Excel file')); } finally { setExporting(false); }
    };

    const t = sales?.totals;
    const series = (sales?.series || []).map((x) => ({ label: x.period, value: x.revenue }));
    const due = bill?.due?.amount || 0;

    return (
        <OwnerScreen title={tr('Money')} onRefresh={refresh} refreshing={refreshing}>
            {due > 0 ? (
                <Card tone={error} onPress={() => nav.navigate('OwnerRent')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="alert-circle" size={26} color={error} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: error, fontWeight: '900' }}>{tr('Monthly bill due: {money}', { money: money(due) })}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{bill.paused ? tr('Your menu and settings are locked until it is paid.') : bill.graceDaysLeft != null ? tr('{graceDaysLeft} {v2} left to pay.', { graceDaysLeft: bill.graceDaysLeft, v2: bill.graceDaysLeft === 1 ? 'day' : 'days' }) : tr('Please pay it.')}</Text>
                        </View>
                        <Pill label={tr('Pay')} color={error} />
                    </View>
                </Card>
            ) : null}

            <View style={{ paddingHorizontal: 16 }}>
                <Chips options={PERIODS} value={period} onChange={pick} style={{ marginTop: 0 }} />
            </View>

            {salesErr && !sales ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={salesErr} /> : null}
            {sales ? (
                <>
                    <Card>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Sales (delivered orders)')}</Text>
                        <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(t.revenue)}</Text>
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

            <Card tone={sms?.zero ? error : undefined}>
                <Row
                    icon="mail"
                    title={tr('SMS balance')}
                    subtitle={sms ? (sms.zero ? tr('Finished. Order SMS alerts have stopped.') : sms.low ? tr('Running low') : tr('About {v1} messages', { v1: Math.floor(sms.balancePaise / Math.max(1, sms.ratePerSmsPaise)) })) : ''}
                    right={<Text style={{ color: sms?.low ? error : text, fontWeight: '900', fontSize: 16 }}>{sms ? rupees(sms.balancePaise) : '—'}</Text>}
                    color={sms?.low ? error : primary}
                    onPress={() => nav.navigate('OwnerSms')}
                    last
                />
            </Card>

            <Card>
                <Row icon="trending-up" title={tr('Business report')} subtitle={tr('Progress, customers, best food and tips')} onPress={() => nav.navigate('OwnerBusiness')} />
                <Row icon="swap-vertical" title={tr('Transactions and bills')} subtitle={tr('Every payment, year by year and month by month')} onPress={() => nav.navigate('OwnerTransactions')} last />
            </Card>

            <Card>
                <Row
                    icon="receipt"
                    title={tr('Monthly bill')}
                    subtitle={bill ? (bill.free?.active ? tr('Free for now{v1}', { v1: bill.free.ordersLeft != null ? ` · ${bill.free.ordersLeft} free orders left` : '' }) : tr('{billableOrders} orders this month · {v2}', { billableOrders: bill.thisMonth.billableOrders, v2: bill.thisMonth.tierLabel || '' })) : ''}
                    right={due > 0 ? <Pill label={tr('Due {money}', { money: money(due) })} color={error} /> : null}
                    onPress={() => nav.navigate('OwnerRent')}
                    last
                />
            </Card>
        </OwnerScreen>
    );
}
