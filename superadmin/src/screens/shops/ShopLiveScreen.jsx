import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Stat, SectionTitle, Badge, KeyValue } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { useShopStore } from '../../store/useShopStore';
import { errMsg } from '../../api/adminClient';
import { rupees, paise, ago, titleCase } from '../../utils/format';

const POLL_MS = 15000;
const STATUS_ORDER = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const FEED_TONE = { orders: 'primary', riders: 'neutral', billing: 'warn', sms: 'neutral', settings: 'neutral', logins: 'neutral', complaints: 'danger', messages: 'neutral' };

export default function ShopLiveScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const live = useShopStore((s) => s.live[shopId]);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const timer = useRef(null);

    const pull = useCallback(async () => {
        try { await useShopStore.getState().loadLive(shopId); setError(null); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);

    // refresh every 15 s while this screen is in front; stop when it is not
    useFocusEffect(useCallback(() => {
        pull();
        timer.current = setInterval(pull, POLL_MS);
        return () => clearInterval(timer.current);
    }, [pull]));

    useEffect(() => () => clearInterval(timer.current), []);

    const refresh = async () => { setRefreshing(true); await pull(); setRefreshing(false); };

    if (!live) {
        return <Screen title="Live activity" subtitle={name}>{error ? <ErrorBox message={error} onRetry={pull} /> : <SkeletonList count={4} />}</Screen>;
    }

    const active = live.orders?.active || {};
    const online = (live.riders || []).filter((r) => r.isOnline);

    return (
        <Screen title="Live activity" subtitle={name} refreshing={refreshing} onRefresh={refresh}>
            <Text style={{ color: t.muted, fontSize: font.xs, marginBottom: spacing.md }}>Updated {ago(live.at)} · refreshes every 15 s</Text>

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Stat section="orders" label="Active orders" value={live.orders?.activeTotal ?? 0} icon="fire" />
                <Stat section="money" label="Sales today" value={rupees(live.revenueToday)} icon="rupee" />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <Stat section="riders" label="Riders online" value={online.length} icon="rider" />
                <Stat section={live.openComplaints ? 'alerts' : 'people'} label="Open complaints" value={live.openComplaints ?? 0} icon="message" />
            </View>

            <SectionTitle section="orders">Orders in progress</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                {STATUS_ORDER.map((st, i) => (
                    <KeyValue key={st} label={titleCase(st)} value={String(active[st] || 0)} last={i === STATUS_ORDER.length - 1} />
                ))}
            </Card>

            <SectionTitle section="riders">Riders</SectionTitle>
            {live.riders?.length ? (
                <Card style={{ paddingVertical: 0 }}>
                    {live.riders.map((r, i) => (
                        <KeyValue
                            key={String(r.riderId)}
                            label={r.name || 'Rider'}
                            value={`${r.isOnline ? 'Online' : 'Offline'} · ${r.activeOrderCount} order${r.activeOrderCount === 1 ? '' : 's'}`}
                            last={i === live.riders.length - 1}
                        />
                    ))}
                </Card>
            ) : <Text style={{ color: t.muted }}>No riders online right now.</Text>}

            <SectionTitle section="platform">This shop</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Customers" value={String(live.customers ?? 0)} />
                <KeyValue label="Billable orders today" value={String(live.billable?.today ?? 0)} />
                <KeyValue label="Billable orders this month" value={String(live.billable?.month ?? 0)} />
                <KeyValue label="SMS wallet" value={paise(live.sms?.balancePaise)} />
                <KeyValue label="Billing" value={live.billingState ? titleCase(live.billingState) : '—'} last />
            </Card>

            <SectionTitle section="people">Recent activity</SectionTitle>
            {live.feed?.length ? (
                <Card padded={false}>
                    {live.feed.slice(0, 20).map((e, i) => (
                        <View
                            key={e.id}
                            style={{ padding: spacing.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: i === Math.min(live.feed.length, 20) - 1 ? 0 : 0.5, borderBottomColor: t.border }}
                        >
                            <View style={{ flex: 1, paddingRight: spacing.md }}>
                                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '600' }} numberOfLines={1}>{titleCase(e.type)}</Text>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{ago(e.at)}</Text>
                            </View>
                            <Badge label={titleCase(e.category)} tone={FEED_TONE[e.category] || 'neutral'} />
                        </View>
                    ))}
                </Card>
            ) : <Empty icon="live" title="No activity yet" />}
        </Screen>
    );
}
