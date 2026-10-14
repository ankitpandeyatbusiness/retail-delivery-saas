import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Stat, SectionTitle, Badge } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { fetchHealth } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, ago } from '../../utils/format';

const RANGES = [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }];
const LEVEL = { good: { label: 'Healthy', tone: 'success' }, watch: { label: 'Watch', tone: 'warn' }, bad: { label: 'Needs help', tone: 'danger' } };

// How every shop is doing, worst first, with the exact reasons behind each score.
export default function HealthScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [days, setDays] = useState(30);
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (n = days) => {
        try { setD(await fetchHealth(n)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [days]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const pick = (n) => { setDays(n); setD(null); load(n); };
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    return (
        <Screen title="Shop health" subtitle="Who needs your attention" refreshing={refreshing} onRefresh={refresh}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
                {RANGES.map((r) => <Chip key={r.value} label={r.label} active={days === r.value} onPress={() => pick(r.value)} />)}
            </View>
            {error && !d ? <ErrorBox message={error} onRetry={() => load()} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <Stat section="orders" label="Orders" value={String(d.platform.orders)} icon="orders" />
                        <Stat section="money" label="Delivered" value={`${d.platform.successRate}%`} icon="ok" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Cancelled" value={`${d.platform.cancelRate}%`} icon="block" tone={d.platform.cancelRate > 12 ? 'warn' : undefined} />
                        <Stat label="Shops needing attention" value={String(d.platform.needAttention)} icon="warning" tone={d.platform.needAttention ? 'warn' : undefined} />
                    </View>

                    <SectionTitle section="shops">Shops, worst first</SectionTitle>
                    {d.shops.map((s) => {
                        const lv = LEVEL[s.level];
                        const color = s.level === 'good' ? t.success : s.level === 'watch' ? t.warn : t.danger;
                        return (
                            <Card key={s.id} onPress={() => nav.navigate('ShopReadiness', { shopId: String(s.id), name: s.name })} style={{ marginBottom: spacing.md }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 4, borderColor: color, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                                        <Text style={{ color, fontWeight: '800', fontSize: font.md }}>{s.score}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }} numberOfLines={1}>{s.name}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.sm }}>
                                            {s.orders} orders · {s.delivered} delivered · {rupeesFromPaise(s.revenuePaise)}
                                        </Text>
                                    </View>
                                    <Badge label={lv.label} tone={lv.tone} />
                                </View>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>
                                    {s.avgMinutes ? `Avg delivery ${s.avgMinutes} min · ` : ''}{s.cancelled} cancelled · {s.complaints} complaints{s.rating ? ` · rating ${s.rating.toFixed(1)}` : ''}
                                    {s.lastOrderAt ? ` · last order ${ago(s.lastOrderAt)}` : ' · no order yet'}
                                </Text>
                                {s.reasons.map((r) => (
                                    <Text key={r.text} style={{ color: t.text, fontSize: font.sm, marginTop: 4 }}>• {r.text} <Text style={{ color: t.muted }}>(−{r.points})</Text></Text>
                                ))}
                            </Card>
                        );
                    })}
                </>
            )}
        </Screen>
    );
}
