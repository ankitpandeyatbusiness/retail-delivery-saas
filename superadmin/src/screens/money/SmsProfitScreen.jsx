import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Stat, SectionTitle, Badge } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { fetchSmsProfit } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise } from '../../utils/format';

const RANGES = [
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: 'all', label: 'All time' },
];

// What the SMS business earns: revenue minus cost, per shop.
export default function SmsProfitScreen() {
    const t = useTheme();
    const [range, setRange] = useState('30');
    const [r, setR] = useState(null);
    const [error, setError] = useState('');
    const query = useMemo(() => (range === 'all' ? {} : { from: new Date(Date.now() - Number(range) * 86400000).toISOString() }), [range]);

    useEffect(() => {
        let alive = true;
        setR(null); setError('');
        fetchSmsProfit(query).then((x) => alive && setR(x)).catch((e) => alive && setError(errMsg(e)));
        return () => { alive = false; };
    }, [query]);

    return (
        <Screen title="SMS profit" subtitle="Revenue minus cost">
            <View style={{ height: 48, marginHorizontal: -spacing.lg }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {RANGES.map((x) => <Chip key={x.value} label={x.label} active={range === x.value} onPress={() => setRange(x.value)} />)}
                </ScrollView>
            </View>
            {error ? <ErrorBox message={error} onRetry={() => setRange((v) => v)} /> : !r ? <SkeletonDashboard /> : !r.items.length ? (
                <Empty icon="message" title="No SMS in this period" hint="Profit shows once shops send SMS." />
            ) : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                        <Stat section={r.totals.profitPaise >= 0 ? 'money' : 'alerts'} label="Profit" value={rupeesFromPaise(r.totals.profitPaise)} icon="chart" />
                        <Stat section="shops" label="SMS sent" value={r.totals.sms} icon="message" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Revenue" value={rupeesFromPaise(r.totals.revenuePaise)} icon="rupee" />
                        <Stat label="Cost" value={rupeesFromPaise(r.totals.costPaise)} icon="wallet" />
                    </View>

                    <SectionTitle section="shops">By shop</SectionTitle>
                    {r.items.map((s) => (
                        <Card key={String(s.tenantId)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }} numberOfLines={1}>{s.name || 'Removed shop'}</Text>
                                <Text style={{ color: s.profitPaise >= 0 ? t.success : t.danger, fontWeight: '800' }}>{rupeesFromPaise(s.profitPaise)}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                                <Badge label={`${s.sms} SMS`} />
                                <Badge label={`Revenue ${rupeesFromPaise(s.revenuePaise)}`} tone="info" />
                                <Badge label={`Cost ${rupeesFromPaise(s.costPaise)}`} tone="warn" />
                                {s.topupPaise ? <Badge label={`Top-ups ${rupeesFromPaise(s.topupPaise)}`} tone="success" /> : null}
                            </View>
                        </Card>
                    ))}
                </>
            )}
        </Screen>
    );
}
