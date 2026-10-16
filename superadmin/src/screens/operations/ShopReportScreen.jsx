import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius, tint } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Chip, SectionTitle, KeyValue, Stat } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { fetchShopReport } from '../../api/reportApi';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (key, kind) => (kind === 'month' ? MONTHS[Number(String(key).slice(5, 7)) - 1] : `${Number(String(key).slice(8, 10))} ${MONTHS[Number(String(key).slice(5, 7)) - 1]}`);
const TONE = { good: 'success', watch: 'warn', idea: 'info' };
const lastMonth = () => { const d = new Date(Date.now() + 330 * 60000); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

function Bars({ points, kind }) {
    const t = useTheme();
    const [pick, setPick] = useState(null);
    const max = Math.max(1, ...points.map((p) => p.revenue));
    const p = pick !== null ? points[pick] : null;
    return (
        <View>
            <Text style={{ color: p ? t.text : t.muted, fontWeight: p ? '800' : '500', minHeight: 22 }}>
                {p ? `${kind === 'week' ? 'Week of ' : ''}${label(p.key, kind)}: ${rupees(p.revenue)} from ${p.orders} orders` : 'Tap a bar to see its number'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, marginTop: 6 }}>
                {points.map((x, i) => (
                    <Pressable key={x.key} onPress={() => setPick(pick === i ? null : i)} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <View style={{ width: '62%', minHeight: 3, height: `${Math.max(3, (x.revenue / max) * 100)}%`, borderRadius: 4, backgroundColor: x.revenue <= 0 ? t.border : pick === i ? t.primary : tint(t.primary, 0.55) }} />
                    </Pressable>
                ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: t.muted, fontSize: font.xs }}>{label(points[0].key, kind)}</Text>
                <Text style={{ color: t.muted, fontSize: font.xs }}>{label(points[points.length - 1].key, kind)}</Text>
            </View>
        </View>
    );
}

// How one shop is doing: the report its owner sees, so you can judge a shop in seconds.
export default function ShopReportScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [range, setRange] = useState('30');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchShopReport(shopId, range)); } catch (e) { setErr(errMsg(e)); }
    }, [shopId, range]);
    useEffect(() => { load(); }, [load]);

    const tt = r?.totals;
    return (
        <Screen title="Progress report" subtitle={name} onRefresh={load}>
            <View style={{ height: 52 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    <Chip label="7 days" active={range === '7'} onPress={() => setRange('7')} />
                    <Chip label="30 days" active={range === '30'} onPress={() => setRange('30')} />
                    <Chip label="3 months" active={range === '90'} onPress={() => setRange('90')} />
                    <Chip label="Last month" active={range === lastMonth()} onPress={() => setRange(lastMonth())} />
                </ScrollView>
            </View>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {r ? (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
                        <Stat section="money" label="Sales" value={rupees(tt.revenue)} icon="wallet" />
                        <Stat section="orders" label="Orders" value={String(tt.orders)} icon="orders" />
                    </View>
                    <Card>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
                            <Badge label={r.change.revenue === null ? 'no earlier period' : `${r.change.revenue >= 0 ? '+' : ''}${r.change.revenue}% sales vs before`} tone={r.change.revenue === null ? 'neutral' : r.change.revenue >= 0 ? 'success' : 'danger'} />
                            <Badge label={`${r.customers.unique} customers`} />
                            <Badge label={`${r.customers.repeatPct}% came back`} tone={r.customers.repeatPct >= 40 ? 'success' : 'neutral'} />
                        </View>
                        <Bars points={r.series.points} kind={r.series.kind} />
                    </Card>

                    <SectionTitle section="money">The app's value for this shop</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Sales through the app" value={rupees(r.value.revenue)} />
                        {r.value.show ? <KeyValue label={`Marketplace commission avoided (${r.value.commissionPct}%, estimate)`} value={rupees(r.value.marketplaceCost)} /> : null}
                        <KeyValue label="Billed to the shop in this time" value={rupees(r.value.feeBilled)} />
                        <KeyValue label="Sales per ₹1 paid" value={r.value.roi ? `₹${Math.round(r.value.roi)}` : 'no bill yet'} />
                        <KeyValue label="Since joining" value={`${r.value.lifetime.orders} orders · ${rupees(r.value.lifetime.revenue)} · ${r.value.lifetime.customers} customers`} last />
                    </Card>

                    <SectionTitle section="orders">Orders and customers</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Average order" value={rupees(tt.avgOrder)} />
                        <KeyValue label="Cancelled" value={`${tt.cancelled} of ${tt.placed} (${tt.cancelRate}%)`} />
                        <KeyValue label="Busiest time" value={r.busiest.hourLabel ? `${r.busiest.weekday}, around ${r.busiest.hourLabel}` : 'not enough orders'} />
                        <KeyValue label="New customers" value={String(r.customers.newCount)} />
                        <KeyValue label="Best seller" value={r.food.top[0] ? `${r.food.top[0].name} (${r.food.top[0].quantity})` : 'none yet'} />
                        <KeyValue label="Best rated" value={r.food.loved[0] ? `${r.food.loved[0].name} (${r.food.loved[0].avg}★)` : 'not enough ratings'} />
                        <KeyValue label="Best rider" value={r.delivery.best ? `${r.delivery.best.name} (${r.delivery.best.deliveries})` : 'none'} last />
                    </Card>

                    {r.tips.length ? (
                        <>
                            <SectionTitle section="platform">What the owner is advised</SectionTitle>
                            {r.tips.map((x) => (
                                <Card key={x.id}>
                                    <Badge label={x.tone === 'good' ? 'Good' : x.tone === 'watch' ? 'Watch' : 'Idea'} tone={TONE[x.tone]} />
                                    <Text style={{ color: t.text, fontWeight: '800', marginTop: spacing.sm }}>{x.title}</Text>
                                    <Text style={{ color: t.muted, marginTop: 2 }}>{x.detail}</Text>
                                </Card>
                            ))}
                        </>
                    ) : null}
                </>
            ) : null}
        </Screen>
    );
}
