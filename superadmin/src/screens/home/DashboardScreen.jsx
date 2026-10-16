import React, { useCallback, useRef, useState } from 'react';
import { FadeIn, animateNext } from '../../components/motion';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Stat, Card, Button, SectionTitle, ListRow } from '../../components/ui';
import { ShopRow } from '../../components/shopBits';
import { QuickActions, StatStrip, RankRow, SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { useDashboardStore } from '../../store/useDashboardStore';
import { useAuthStore } from '../../store/useAuthStore';
import { rupees } from '../../utils/format';
import { fetchSupportCounts } from '../../api/supportApi';

const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// The platform at a glance: today's numbers, where to act, and shortcuts to the common jobs.
export default function DashboardScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const d = useDashboardStore();
    const admin = useAuthStore((s) => s.admin);

    const [helpOpen, setHelpOpen] = useState(0);
    useFocusEffect(useCallback(() => {
        useDashboardStore.getState().load({ refresh: !!useDashboardStore.getState().shops });
        fetchSupportCounts().then((c) => setHelpOpen(c.open || 0)).catch(() => { });
    }, []));

    const first = d.shops === null && d.loading;
    const goShops = (params) => nav.navigate('ShopsTab', params ? { screen: 'ShopsList', params } : undefined);
    const overdue = parseInt(d.overdueInvoices, 10) || 0;
    const alerts = [
        helpOpen > 0 && { icon: 'message', title: `${helpOpen} support request${helpOpen > 1 ? 's' : ''} waiting`, hint: 'Shop owners are waiting for your reply', go: () => nav.navigate('Support') },
        d.unreadAlerts > 0 && { icon: 'bell', title: `${d.unreadAlerts} unread alert${d.unreadAlerts > 1 ? 's' : ''}`, hint: 'Late orders and platform messages' },
        overdue > 0 && { icon: 'receipt', title: `${d.overdueInvoices} overdue rent invoice${String(d.overdueInvoices) === '1' ? '' : 's'}`, hint: 'Shops that have not paid yet' },
    ].filter(Boolean);

    // sections that appear or disappear (alerts, attention list) let their neighbours glide
    const shape = `${alerts.length}-${d.attention.length}-${d.today?.topShops?.length || 0}`;
    const lastShape = useRef(shape);
    if (lastShape.current !== shape) { lastShape.current = shape; animateNext(); }

    return (
        <Screen
            tabScreen
            right={<HeaderButton icon="search" onPress={() => nav.navigate('Search')} />}
            title={greeting()}
            subtitle={admin?.name || 'Platform overview'}
            refreshing={d.refreshing}
            onRefresh={() => d.load({ refresh: true })}
        >
            {first ? <SkeletonDashboard /> : d.error && d.shops === null ? (
                <ErrorBox message={d.error} onRetry={() => d.load()} />
            ) : d.shops && d.shops.total === 0 ? (
                <>
                    <Empty icon="shops" title="No shops yet" hint="Create your first shop to start taking orders on the platform." />
                    <Button title="Add the first shop" icon="addCircle" onPress={() => nav.navigate('ShopsTab', { screen: 'ShopCreate' })} />
                </>
            ) : (
                <>
                    <FadeIn index={0}>
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            <Stat section="orders" label="Orders today" value={d.today ? d.today.orders : '—'} icon="orders" />
                            <Stat section="money" label="Sales today" value={d.today ? rupees(d.today.revenue) : '—'} icon="rupee" />
                        </View>
                    </FadeIn>

                    <FadeIn index={1}>
                        <SectionTitle section="shops">Shops</SectionTitle>
                        <StatStrip
                            items={[
                                { label: 'Total', value: d.shops ? d.shops.total : '—', section: 'shops', onPress: () => goShops({ filter: 'all' }) },
                                { label: 'Taking orders', value: d.shops ? d.shops.taking : '—', section: 'money', onPress: () => goShops({ filter: 'open' }) },
                                { label: 'Need attention', value: d.shops ? d.shops.attention : '—', section: d.shops?.attention ? 'alerts' : 'riders', onPress: () => goShops({ filter: 'attention' }) },
                                { label: 'Suspended', value: d.shops ? d.shops.suspended : '—', section: 'platform', onPress: () => goShops({ filter: 'suspended' }) },
                            ]}
                        />
                    </FadeIn>

                    <FadeIn index={2}>
                        <SectionTitle section="settings">Quick actions</SectionTitle>
                        <QuickActions
                            items={[
                                { label: 'New shop', icon: 'addCircle', section: 'shops', onPress: () => nav.navigate('ShopsTab', { screen: 'ShopCreate' }) },
                                { label: 'All shops', icon: 'shops', section: 'platform', onPress: () => goShops({ filter: 'all' }) },
                                { label: 'Needs attention', icon: 'warning', section: 'alerts', badge: d.shops?.attention || undefined, onPress: () => goShops({ filter: 'attention' }) },
                                { label: 'Team', icon: 'crown', section: 'settings', onPress: () => nav.navigate('MoreTab', { screen: 'Team' }) },
                            ]}
                        />
                    </FadeIn>

                    {alerts.length ? (
                        <FadeIn index={3}>
                            <SectionTitle section="alerts">Alerts</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {alerts.map((a, i) => <ListRow key={a.title} icon={a.icon} section="alerts" title={a.title} subtitle={a.hint} onPress={a.go} last={i === alerts.length - 1} />)}
                            </Card>
                        </FadeIn>
                    ) : null}

                    {d.attention.length ? (
                        <>
                            <SectionTitle section="alerts">Not taking orders</SectionTitle>
                            {d.attention.map((s) => (
                                <ShopRow
                                    key={s._id}
                                    shop={s}
                                    compact
                                    onPress={() => nav.navigate('ShopsTab', { screen: 'ShopDetail', params: { shopId: s._id, name: s.name } })}
                                />
                            ))}
                        </>
                    ) : null}

                    {d.today?.topShops?.length ? (
                        <>
                            <SectionTitle section="money">Top shops today</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {d.today.topShops.map((s, i) => (
                                    <RankRow
                                        key={String(s.tenantId)}
                                        rank={i + 1}
                                        title={s.name}
                                        subtitle={`${s.orders} order${s.orders === 1 ? '' : 's'}`}
                                        value={rupees(s.revenue)}
                                        last={i === d.today.topShops.length - 1}
                                    />
                                ))}
                            </Card>
                        </>
                    ) : null}
                    <Text style={{ color: t.muted, fontSize: font.xs, textAlign: 'center', marginTop: spacing.xl }}>Pull down to refresh</Text>
                </>
            )}
        </Screen>
    );
}
