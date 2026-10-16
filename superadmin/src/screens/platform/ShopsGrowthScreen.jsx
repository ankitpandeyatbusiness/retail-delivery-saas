import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, SectionTitle, ListRow, Stat } from '../../components/ui';
import { Segmented } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { fetchShopsGrowth } from '../../api/reportApi';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

const pct = (c) => (c === null || c === undefined ? 'new' : `${c >= 0 ? '+' : ''}${c}%`);

// How the shops are doing, side by side: who is growing, who is slowing down, and what the platform made in total.
export default function ShopsGrowthScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [days, setDays] = useState('30');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchShopsGrowth(Number(days))); } catch (e) { setErr(errMsg(e)); }
    }, [days]);
    useEffect(() => { load(); }, [load]);

    const row = (s, i, list, extra) => (
        <ListRow
            key={s.id}
            section="shops"
            icon="store"
            title={s.name}
            subtitle={extra || `${rupees(s.revenue)} · ${s.orders} orders · ${s.customers} customers`}
            right={<Badge label={pct(s.change)} tone={s.change === null ? 'neutral' : s.change >= 0 ? 'success' : 'danger'} />}
            onPress={() => nav.navigate('ShopsTab', { screen: 'ShopReport', params: { shopId: s.id, name: s.name } })}
            last={i === list.length - 1}
        />
    );

    return (
        <Screen title="Shops growth" subtitle="Sales of delivered orders against the same number of days before" onRefresh={load}>
            <Segmented options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} value={days} onChange={setDays} />
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {r ? (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginVertical: spacing.md }}>
                        <Stat section="money" label="Sales" value={rupees(r.totals.revenue)} icon="wallet" />
                        <Stat section="orders" label="Orders" value={String(r.totals.orders)} icon="orders" />
                    </View>
                    <Card>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                            <Badge label={`${pct(r.totals.change)} sales vs before`} tone={r.totals.change === null ? 'neutral' : r.totals.change >= 0 ? 'success' : 'danger'} />
                            <Badge label={`${r.shops} shops`} />
                            <Badge label={`${r.quiet} live shops with no orders`} tone={r.quiet ? 'warn' : 'neutral'} />
                            <Badge label={`Autopilot on in ${r.autopilot.shopsOn} shops · ${r.autopilot.messages} messages`} tone="info" />
                        </View>
                    </Card>

                    <SectionTitle section="money">Top shops</SectionTitle>
                    {r.leaderboard.length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>{r.leaderboard.slice(0, 10).map((s, i, a) => row(s, i, a))}</Card>
                    ) : <Text style={{ color: t.muted, fontSize: font.sm }}>No sales in this time yet.</Text>}

                    <SectionTitle section="shops">Growing fast</SectionTitle>
                    {r.growing.length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>{r.growing.map((s, i, a) => row(s, i, a))}</Card>
                    ) : <Text style={{ color: t.muted, fontSize: font.sm }}>No shop is up 20% or more.</Text>}

                    <SectionTitle section="alerts">Slowing down</SectionTitle>
                    {r.slowing.length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                            {r.slowing.map((s, i, a) => row(s, i, a, s.idleDays !== null && s.idleDays >= 14 ? `No order for ${s.idleDays} days · was ${rupees(s.prevRevenue)}` : `${rupees(s.revenue)} now · ${rupees(s.prevRevenue)} before`))}
                        </Card>
                    ) : <Text style={{ color: t.muted, fontSize: font.sm }}>No shop is slowing down.</Text>}
                </>
            ) : null}
        </Screen>
    );
}
