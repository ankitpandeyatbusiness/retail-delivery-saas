import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Stat, SectionTitle, ListRow, Badge } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { SearchBar } from '../../components/inputs';
import MoneySearch from '../../components/MoneySearch';
import { ErrorBox } from '../../components/feedback';
import { fetchPlatform } from '../../api/moneyApi';
import { fetchMonth, fetchNext30, fetchMoneyAttention, fetchProfitPeriods } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise } from '../../utils/format';

const vs = (pct) => (pct === null || pct === undefined ? '' : pct === 0 ? 'Same as last month' : `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on last month`);

// The Money tab: how this month is going, what needs a look today, and the doors to collecting, profit, closing the month and the rules.
export default function MoneyHomeScreen() {
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [q, setQ] = useState('');

    const load = useCallback(async () => {
        try {
            const [month, next, att, plat, per] = await Promise.all([fetchMonth(), fetchNext30(), fetchMoneyAttention(), fetchPlatform(), fetchProfitPeriods().catch(() => null)]);
            setD({ month, next, att, per, businessSet: !!plat.business?.legalName, gstSet: !!plat.business?.gstin });
            setError('');
        } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
    const go = (screen, params) => () => nav.navigate(screen, params);

    return (
        <Screen tabScreen title="Money" subtitle="Plans, profit and what to look at" refreshing={refreshing} onRefresh={refresh}>
            <View style={{ marginBottom: spacing.lg }}><SearchBar value={q} onChangeText={setQ} placeholder="Search payments, refunds, invoices" /></View>
            {q.trim() ? <MoneySearch q={q} /> : error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <Stat section="money" label="Collected this month" value={rupeesFromPaise(d.month.current.collectedPaise)} icon="wallet" note={vs(d.month.change.collected)} onPress={go('MonthClose')} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Plans ending in 30 days" value={rupeesFromPaise(d.next.nextBillsEstimatePaise)} icon="clock" note={`${d.next.endingPlans ? d.next.endingPlans.count : 0} paid, if renewed`} onPress={go('MonthClose')} />
                        <Stat label={d.month.current.netPaise < 0 ? 'Loss this month' : 'Net this month'} value={rupeesFromPaise(d.month.current.netPaise)} icon="chart" tone={d.month.current.netPaise < 0 ? 'danger' : 'success'} note={vs(d.month.change.net)} onPress={go('ProfitLoss')} />
                    </View>

                    {d.per ? (
                        <>
                            <SectionTitle section="catalog">Your profit</SectionTitle>
                            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                                {[['week', 'This week'], ['month', 'This month'], ['year', 'This year']].map(([k, label]) => (
                                    <Stat key={k} label={d.per[k].netPaise < 0 ? `Loss ${label.toLowerCase()}` : label} value={rupeesFromPaise(d.per[k].netPaise)} icon="chart" tone={d.per[k].netPaise < 0 ? 'danger' : 'success'} compact note={`${d.per[k].prevNetPaise < 0 ? '-' : ''}${rupeesFromPaise(Math.abs(d.per[k].prevNetPaise))} before`} onPress={go('ProfitLoss')} />
                                ))}
                            </View>
                        </>
                    ) : null}

                    {!d.businessSet ? (
                        <Card onPress={go('PlatformBusiness')} style={{ marginTop: spacing.lg }}>
                            <Badge label="Set up first" tone="warn" icon="warning" />
                            <ListRow section="platform" icon="bank" title="Fill in your business details" subtitle="Needed before invoices can be made" last />
                        </Card>
                    ) : null}

                    <SectionTitle section="alerts">Needs attention{d.att.counts.total ? ` · ${d.att.counts.total}` : ''}</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {d.att.items.length ? d.att.items.map((it, i) => (
                            <ListRow
                                key={it.key}
                                section={it.level === 'bad' ? 'alerts' : 'catalog'}
                                icon={it.level === 'bad' ? 'warning' : 'clock'}
                                title={`${it.title} · ${it.count}${it.paise ? ' · ' + rupeesFromPaise(it.paise) : ''}`}
                                subtitle={it.hint}
                                onPress={it.key === 'sms_provider' ? go(it.screen, it.params) : go('MoneyAttention', { key: it.key, title: it.title })}
                                last={i === d.att.items.length - 1}
                            />
                        )) : <ListRow section="riders" icon="ok" title="All clear" subtitle="No bill, refund or payment needs a look right now." last />}
                    </Card>

                    <SectionTitle section="money">Money in</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="people" icon="wallet" title="Transactions" subtitle="Everything received from shops" onPress={go('Ledger')} last />
                    </Card>

                    <SectionTitle section="catalog">Profit</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="chart" title="This month" subtitle="This month against last, GST, what is owed" onPress={go('MonthClose')} />
                        <ListRow section="money" icon="chart" title="Profit and loss" subtitle="Income, costs and exactly why" onPress={go('ProfitLoss')} />
                        <ListRow section="catalog" icon="wallet" title="Your expenses" subtitle="Hosting, SMS provider, staff..." onPress={go('Expenses')} />
                        <ListRow section="catalog" icon="chart" title="SMS profit" subtitle="Revenue minus cost, per shop" onPress={go('SmsProfit')} />
                        <ListRow section="catalog" icon="wallet" title="SMS balance" subtitle="What is left at your SMS provider, and the low line" onPress={go('SmsBalance')} last />
                    </Card>

                    <SectionTitle section="platform">Close the month</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="receipt" title="Download for my CA" subtitle="One Excel: bills, SMS top-ups, GST register, expenses" onPress={go('MonthClose')} />
                        <ListRow section="money" icon="receipt" title="GST register" subtitle="Every bill and credit note with its tax" onPress={go('GstRegister')} />
                        <ListRow section="people" icon="rupee" title="Shop money" subtitle="What shops paid each month, and your yes/no" onPress={go('MoneyRecord')} last />
                    </Card>

                    <SectionTitle section="settings">Settings</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="settings" icon="tune" title="Money settings" subtitle={d.gstSet ? 'Billing rules, GST, refund rules, business details, Razorpay, SMS prices' : 'No GST number saved yet. Open to set it'} onPress={go('MoneySettings')} last />
                    </Card>
                </>
            )}
        </Screen>
    );
}
