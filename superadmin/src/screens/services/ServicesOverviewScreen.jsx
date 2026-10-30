import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, SectionTitle, ListRow, KeyValue, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { fetchServicesOverview } from '../../api/servicesApi';
import { errMsg } from '../../api/adminClient';

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
export const rs = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
export const mins = (m) => (m === null || m === undefined ? '-' : m < 90 ? `${m} min` : `${Math.round(m / 60)} h`);

// Inquiries, table bookings and the booking money of every shop, to read. The owners do the work; this page shows how it is going and where
// an inquiry is waiting too long. The per-shop switches are in each shop's "App features".
export default function ServicesOverviewScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [days, setDays] = useState(30);
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => { setErr(''); try { setD(await fetchServicesOverview({ days })); } catch (e) { setErr(errMsg(e)); } }, [days]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!d) return <Screen title="Services and booking" subtitle="Inquiries and table bookings" onRefresh={load}>{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={4} avatar={false} />}</Screen>;
    const T = d.totals;

    return (
        <Screen title="Services and booking" subtitle="Inquiries and table bookings" onRefresh={load}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
                {RANGES.map(([n, l]) => <Chip key={n} label={l} active={days === n} onPress={() => setDays(n)} />)}
            </View>

            <SectionTitle section="orders">Inquiries</SectionTitle>
            <Card>
                <KeyValue label="Received" value={String(T.inquiries.total)} />
                <KeyValue label="Not answered yet (new)" value={String(T.inquiries.new)} />
                <KeyValue label={`Waiting more than ${d.reminderHours} hours`} value={String(T.inquiries.unanswered)} />
                <KeyValue label="Average time to the first reply" value={mins(T.inquiries.avgReplyMin)} last />
            </Card>

            <SectionTitle section="orders">Table bookings</SectionTitle>
            <Card>
                <KeyValue label="Paid bookings" value={String(T.bookings.total)} />
                <KeyValue label="Booked, not yet seated" value={String(T.bookings.confirmed)} />
                <KeyValue label="Seated" value={String(T.bookings.seated)} />
                <KeyValue label="No-show" value={String(T.bookings.noShow)} />
                <KeyValue label="Cancelled" value={String(T.bookings.cancelled)} />
                <KeyValue label="Guests waiting for a table" value={String(T.waiting)} last />
            </Card>

            <SectionTitle section="money">Booking money (deposits)</SectionTitle>
            <Card>
                <KeyValue label="Collected from guests" value={rs(T.money.collected)} />
                <KeyValue label="Refunded to guests" value={rs(T.money.refunded)} />
                <KeyValue label="Kept by the restaurants" value={rs(T.money.kept)} />
                <KeyValue label="Taken off dine-in bills" value={rs(T.money.adjusted)} />
                <KeyValue label="Held for upcoming visits" value={rs(T.money.held)} last />
            </Card>

            <SectionTitle section="shops">Shops</SectionTitle>
            {!d.shops.length ? <Empty title="No shop uses it yet" hint="Switch Services or Table booking on in a shop's App features." /> : (
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                    {d.shops.map((s, i) => (
                        <ListRow key={s.tenantId} section="shops" icon="shops" last={i === d.shops.length - 1}
                            title={s.shop.name}
                            subtitle={`${s.inquiries.total} inquiries${s.inquiries.unanswered ? ` · ${s.inquiries.unanswered} waiting` : ''} · ${s.bookings.total} bookings · ${rs(s.money.collected)}`}
                            right={s.inquiries.unanswered ? <Badge label={`${s.inquiries.unanswered} late`} tone="danger" /> : undefined}
                            onPress={() => nav.navigate('ServicesShop', { tenantId: s.tenantId, name: s.shop.name, days })} />
                    ))}
                </Card>
            )}

            <SectionTitle section="platform">Defaults</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="platform" icon="settings" last title="Starter services and the reminder" subtitle={`What a new service begins with, and the nudge after ${d.reminderHours} hours`} onPress={() => nav.navigate('ServicesDefaults')} />
            </Card>
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>Read only. The owner of each shop answers inquiries and manages bookings.</Text>
        </Screen>
    );
}
