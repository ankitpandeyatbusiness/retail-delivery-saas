import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Stat, SectionTitle, Badge } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { fetchReceivables } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateOnly } from '../../utils/format';

const BUCKETS = {
    notDue: 'Not due yet', d1_7: '1 to 7 days late', d8_30: '8 to 30 days late', d31_60: '31 to 60 days late', d60plus: 'Over 60 days late',
};
const BEHAVIOUR = {
    not_paying: { label: 'Not paying', tone: 'danger' },
    late_now: { label: 'Late now', tone: 'warn' },
    paying_late: { label: 'Pays late', tone: 'warn' },
    on_time: { label: 'Pays on time', tone: 'success' },
    new: { label: 'New', tone: 'neutral' },
};

// Who owes you rent, how old it is, and who pays late.
export default function ReceivablesScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try { setD(await fetchReceivables()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
    const openShop = (s) => nav.navigate('Admin', { screen: 'ShopsTab', params: { screen: 'ShopBilling', params: { shopId: String(s.tenantId), name: s.name } } });
    const total = d ? d.totals.buckets.reduce((a, b) => a + b.paise, 0) : 0;

    return (
        <Screen title="Who owes you" subtitle="Unpaid rent and payment habits" refreshing={refreshing} onRefresh={refresh}>
            {error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <Stat section={d.totals.overduePaise ? 'alerts' : 'money'} label="Overdue" value={rupeesFromPaise(d.totals.overduePaise)} icon="warning" />
                        <Stat label="All unpaid" value={rupeesFromPaise(d.totals.pendingPaise)} icon="receipt" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Shops overdue" value={String(d.totals.overdueShops)} icon="shops" tone={d.totals.overdueShops ? 'warn' : undefined} />
                        <Stat label="Never paid" value={String(d.totals.neverPaid)} icon="block" tone={d.totals.neverPaid ? 'danger' : undefined} />
                    </View>

                    {total > 0 ? (
                        <>
                            <SectionTitle section="alerts">How old is the unpaid money</SectionTitle>
                            <Card>
                                {d.totals.buckets.map((b, i) => {
                                    const pct = total ? Math.max(b.paise ? 4 : 0, Math.round((b.paise / total) * 100)) : 0;
                                    return (
                                        <View key={b.key} style={{ marginBottom: i === 4 ? 0 : spacing.md }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{BUCKETS[b.key]}</Text>
                                                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '800' }}>{rupeesFromPaise(b.paise)}</Text>
                                            </View>
                                            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surfaceAlt, marginTop: 6 }}>
                                                <View style={{ height: 8, borderRadius: 4, width: `${pct}%`, backgroundColor: b.key === 'notDue' ? t.info : b.key === 'd1_7' ? t.warn : t.danger }} />
                                            </View>
                                        </View>
                                    );
                                })}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="people">Shops that owe you</SectionTitle>
                    {d.shops.length === 0 ? <Empty icon="ok" title="Nobody owes you anything" hint="All rent bills are paid." /> : d.shops.map((s) => {
                        const b = BEHAVIOUR[s.behaviour] || BEHAVIOUR.new;
                        return (
                            <Card key={s.tenantId} onPress={() => openShop(s)} style={{ marginBottom: spacing.md }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', flex: 1 }} numberOfLines={1}>{s.name}</Text>
                                    <Badge label={b.label} tone={b.tone} />
                                </View>
                                <Text style={{ color: s.overduePaise ? t.danger : t.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.sm }}>{rupeesFromPaise(s.unpaidPaise)}</Text>
                                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                                    {s.invoices} bill(s){s.daysOverdue ? ` · ${s.daysOverdue} days overdue` : ' · not due yet'}{s.oldestDueAt ? ` · oldest due ${dateOnly(s.oldestDueAt)}` : ''}
                                </Text>
                                <Text style={{ color: t.muted, fontSize: font.sm }}>
                                    {s.paidCount ? `Paid ${s.paidCount} bill(s) before, on average ${s.avgDaysLate} days late` : 'Has never paid a bill'}
                                    {s.billingState === 'paused' ? ' · shop is paused' : s.billingState === 'grace' ? ' · in grace period' : ''}
                                </Text>
                            </Card>
                        );
                    })}

                    {d.behaviour.length ? (
                        <>
                            <SectionTitle section="riders">Payment habits (shops that paid before)</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {d.behaviour.map((s, i) => (
                                    <View key={s.tenantId} style={{ paddingVertical: spacing.md, borderBottomWidth: i === d.behaviour.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ color: t.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{s.name}</Text>
                                            <Text style={{ color: s.avgDaysLate > 0 ? t.warn : t.success, fontWeight: '800' }}>{s.avgDaysLate > 0 ? `${s.avgDaysLate} days late` : 'On time'}</Text>
                                        </View>
                                        <Text style={{ color: t.muted, fontSize: font.sm }}>{s.paidCount} paid · {s.onTimeRate}% on time{s.lastPaidAt ? ` · last paid ${dateOnly(s.lastPaidAt)}` : ''}</Text>
                                    </View>
                                ))}
                            </Card>
                        </>
                    ) : null}
                </>
            )}
        </Screen>
    );
}
