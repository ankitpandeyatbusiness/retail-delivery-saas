import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Badge, SectionTitle, ListRow, KeyValue } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import BarChart from '../../components/charts';
import Icon from '../../components/Icon';
import { fetchProfitLoss } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, titleCase } from '../../utils/format';

const RANGES = [{ value: 3, label: '3 months' }, { value: 6, label: '6 months' }, { value: 12, label: '12 months' }];
const monthLabel = (k) => new Date(`${k}-15T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

// Is my business in profit or loss, and exactly why.
export default function ProfitLossScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [months, setMonths] = useState(6);
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (m = months) => {
        try { setD(await fetchProfitLoss(m)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [months]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const pick = (m) => { setMonths(m); setD(null); load(m); };
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const profit = d && d.verdict === 'profit';
    const loss = d && d.verdict === 'loss';
    const tone = profit ? t.success : loss ? t.danger : t.muted;
    const toneSoft = profit ? t.successSoft : loss ? t.dangerSoft : t.surfaceAlt;
    const levelTone = { bad: 'danger', warn: 'warn', info: 'info', good: 'success' };
    const levelIcon = { bad: 'warning', warn: 'warning', info: 'info', good: 'ok' };

    return (
        <Screen title="Profit and loss" subtitle="Your business, month by month" refreshing={refreshing} onRefresh={refresh}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
                {RANGES.map((r) => <Chip key={r.value} label={r.label} active={months === r.value} onPress={() => pick(r.value)} />)}
            </View>

            {error && !d ? <ErrorBox message={error} onRetry={() => load()} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ backgroundColor: toneSoft, borderRadius: radius.lg, padding: spacing.lg }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name={profit ? 'chart' : loss ? 'warning' : 'info'} size={26} color={tone} />
                            <Text style={{ color: tone, fontSize: font.md, fontWeight: '800', marginLeft: spacing.sm }}>
                                {profit ? 'You are in PROFIT' : loss ? 'You are in LOSS' : 'Break-even'}
                            </Text>
                        </View>
                        <Text style={{ color: tone, fontSize: 34, fontWeight: '800', marginTop: spacing.sm }} adjustsFontSizeToFit numberOfLines={1}>
                            {loss ? '-' : ''}{rupeesFromPaise(Math.abs(d.totals.netPaise))}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: font.sm }}>in the last {d.months.length} months (income minus costs)</Text>
                    </View>

                    <SectionTitle section="alerts">Why</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
                        {d.reasons.map((r) => (
                            <View key={r.code} style={{ flexDirection: 'row', paddingVertical: spacing.sm }}>
                                <View style={{ marginTop: 2, marginRight: spacing.sm }}><Badge label="" tone={levelTone[r.level]} icon={levelIcon[r.level]} /></View>
                                <Text style={{ flex: 1, color: t.text, fontSize: font.md, lineHeight: 21 }}>{r.text}</Text>
                            </View>
                        ))}
                    </Card>

                    <SectionTitle section="money">Money in and out</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Rent received (without GST)" value={rupeesFromPaise(d.totals.rentIncomePaise)} />
                        <KeyValue label="SMS profit (charged − provider cost)" value={rupeesFromPaise(d.totals.smsMarginPaise)} />
                        <KeyValue label="Total income" value={rupeesFromPaise(d.totals.incomePaise)} />
                        <KeyValue label="Your expenses" value={`-${rupeesFromPaise(d.totals.expensesPaise)}`} />
                        <KeyValue label="Alert SMS you paid for shops" value={`-${rupeesFromPaise(d.totals.platformSmsCostPaise)}`} />
                        <KeyValue label="Net" value={`${d.totals.netPaise < 0 ? '-' : ''}${rupeesFromPaise(Math.abs(d.totals.netPaise))}`} last />
                    </Card>
                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm, paddingHorizontal: 2 }}>
                        GST collected ({rupeesFromPaise(d.totals.gstPaise)}) is not your income, it is for the government, so it is not counted.
                    </Text>

                    <SectionTitle section="money">Income per month</SectionTitle>
                    <Card><BarChart color={t.success} data={d.rows.map((r) => ({ label: monthLabel(r.month), value: r.incomePaise / 100 }))} format={(v) => `₹${Math.round(v)}`} /></Card>
                    <SectionTitle section="alerts">Costs per month</SectionTitle>
                    <Card><BarChart color={t.danger} data={d.rows.map((r) => ({ label: monthLabel(r.month), value: r.costsPaise / 100 }))} format={(v) => `₹${Math.round(v)}`} /></Card>

                    <SectionTitle section="platform">Every month</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {[...d.rows].reverse().map((r, i, a) => (
                            <View key={r.month} style={{ paddingVertical: spacing.md, borderBottomWidth: i === a.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                    <Text style={{ color: t.text, fontWeight: '800' }}>{monthLabel(r.month)}</Text>
                                    <Text style={{ color: r.netPaise < 0 ? t.danger : t.success, fontWeight: '800' }}>
                                        {r.netPaise < 0 ? '-' : '+'}{rupeesFromPaise(Math.abs(r.netPaise))}
                                    </Text>
                                </View>
                                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                                    Income {rupeesFromPaise(r.incomePaise)} · Costs {rupeesFromPaise(r.costsPaise)} · Billed {rupeesFromPaise(r.billedPaise)}
                                </Text>
                            </View>
                        ))}
                    </Card>

                    {d.expensesByCategory.length ? (
                        <>
                            <SectionTitle section="catalog">Where the money goes</SectionTitle>
                            <Card style={{ paddingVertical: 0 }}>
                                {d.expensesByCategory.map((c, i) => (
                                    <KeyValue key={c.category} label={titleCase(c.category)} value={rupeesFromPaise(c.paise)} last={i === d.expensesByCategory.length - 1} />
                                ))}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="people">Next</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="alerts" icon="warning" title="Who owes you money" subtitle={`${rupeesFromPaise(d.receivables.overduePaise)} overdue from ${d.receivables.overdueShops} shop(s)`} onPress={() => nav.navigate('Receivables')} />
                        <ListRow section="catalog" icon="wallet" title="Your expenses" subtitle="Hosting, SMS provider, staff and more" onPress={() => nav.navigate('Expenses')} last />
                    </Card>
                </>
            )}
        </Screen>
    );
}
