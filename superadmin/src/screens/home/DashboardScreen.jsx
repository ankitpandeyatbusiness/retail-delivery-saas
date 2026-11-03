import React, { useCallback, useRef, useState } from 'react';
import { FadeIn, animateNext } from '../../components/motion';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Stat, Card, Button, SectionTitle } from '../../components/ui';
import Icon from '../../components/Icon';
import { ShopRow } from '../../components/shopBits';
import { QuickActions, StatStrip, RankRow, SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { Dot, useLevel } from '../../components/healthBits';
import { useDashboardStore } from '../../store/useDashboardStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useSupreme } from '../../hooks/useSupreme';
import { rupees } from '../../utils/format';
import { fetchSupportCounts } from '../../api/supportApi';
import { fetchPlatformHealth } from '../../api/healthApi';
import { fetchMoneyRecord } from '../../api/moneyRecordApi';

const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const monthOf = (plus = 0) => { const x = new Date(Date.now() + 330 * 60000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + plus, 1)).toISOString().slice(0, 7); };
const LABEL = { system: 'Server and backup', payments: 'Payment notices', sms: 'SMS', rent: 'Rent', orders: 'Orders', google: 'Google calls', shops: 'Shops', support: 'Support', quiet: 'Quiet shops', versions: 'App versions' };

// The platform at a glance: is it fine, what needs you, this month's money, today's orders, and shortcuts to the common jobs.
export default function DashboardScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const level = useLevel();
    const supreme = useSupreme();
    const d = useDashboardStore();
    const admin = useAuthStore((s) => s.admin);

    const [helpOpen, setHelpOpen] = useState(0);
    const [health, setHealth] = useState(null);
    const [money, setMoney] = useState(null);          // this month's shop money
    const [lastOpen, setLastOpen] = useState(0);       // last month's shops the developer has not answered yet
    useFocusEffect(useCallback(() => {
        useDashboardStore.getState().load({ refresh: !!useDashboardStore.getState().shops });
        fetchSupportCounts().then((c) => setHelpOpen(c.open || 0)).catch(() => { });
        fetchPlatformHealth().then(setHealth).catch(() => { });
        fetchMoneyRecord(monthOf()).then(setMoney).catch(() => { });
        fetchMoneyRecord(monthOf(-1)).then((m) => setLastOpen(m.totals.open + m.totals.again)).catch(() => { });
    }, []));

    const first = d.shops === null && d.loading;
    const goShops = (params) => nav.navigate('ShopsTab', params ? { screen: 'ShopsList', params } : undefined);
    const goHealth = () => nav.navigate('PlatformHealth');
    const inHealth = (key) => !!health?.needsYou.some((x) => x.key === key);

    // what needs you now: the health cards that are not green, plus the small things the health screen does not carry
    const need = [
        ...(health ? health.needsYou.slice(0, 4).map((x) => ({ key: x.key, level: x.level, title: LABEL[x.key], hint: x.note, go: goHealth })) : []),
        supreme && lastOpen > 0 && { key: 'answers', level: 'warn', title: 'Shop money to answer', hint: `${lastOpen} shop${lastOpen === 1 ? '' : 's'} of last month: did you get your part?`, go: () => nav.navigate('MoreTab', { screen: 'MoneyRecord' }) },
        !inHealth('support') && helpOpen > 0 && { key: 'help', level: 'warn', title: `${helpOpen} support request${helpOpen > 1 ? 's' : ''} waiting`, hint: 'Shop owners are waiting for your reply', go: () => nav.navigate('Support') },
        d.unreadAlerts > 0 && { key: 'alerts', level: 'warn', title: `${d.unreadAlerts} unread alert${d.unreadAlerts > 1 ? 's' : ''}`, hint: 'Late orders and platform messages', go: () => nav.navigate('Inbox') },
    ].filter(Boolean);

    // sections that appear or disappear let their neighbours glide
    const shape = `${need.length}-${d.attention.length}-${d.today?.topShops?.length || 0}-${health ? 1 : 0}`;
    const lastShape = useRef(shape);
    if (lastShape.current !== shape) { lastShape.current = shape; animateNext(); }

    const o = health && level(health.overall.level);
    const topGoogle = health && [...health.google.apis].sort((a, b) => b.percent - a.percent)[0];

    return (
        <Screen
            tabScreen
            title={greeting()}
            subtitle={admin?.name || 'Platform overview'}
            refreshing={d.refreshing}
            onRefresh={() => { d.load({ refresh: true }); fetchPlatformHealth().then(setHealth).catch(() => { }); }}
        >
            {/* the search box: shops, orders, people, invoices, brands */}
            <Pressable onPress={() => nav.navigate('Search')} accessibilityRole="search" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: spacing.lg, height: 48, marginBottom: spacing.md, borderWidth: 1, borderColor: t.surfaceAlt }}>
                <Icon name="search" size={20} color={t.muted} />
                <Text style={{ color: t.muted, flex: 1 }}>Search shops, orders, people, invoices</Text>
            </Pressable>

            {first ? <SkeletonDashboard /> : d.error && d.shops === null ? (
                <ErrorBox message={d.error} onRetry={() => d.load()} />
            ) : d.shops && d.shops.total === 0 ? (
                <>
                    <Empty icon="shops" title="No shops yet" hint="Create your first shop to start taking orders on the platform." />
                    <Button title="Add the first shop" icon="addCircle" onPress={() => nav.navigate('ShopsTab', { screen: 'ShopCreate' })} />
                </>
            ) : (
                <>
                    {/* the platform light */}
                    <FadeIn index={0}>
                        {health ? (
                            <Pressable onPress={goHealth} accessibilityRole="button" style={{ backgroundColor: o.soft, borderRadius: 16, padding: spacing.lg, borderWidth: 2, borderColor: o.color }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    <Dot level={health.overall.level} size={18} />
                                    <Text style={{ color: o.color, fontWeight: '900', fontSize: font.xl, flex: 1 }}>{health.overall.text}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.sm }}>Platform health ›</Text>
                                </View>
                                <Text style={{ color: t.text, marginTop: 4 }}>{health.overall.level === 'good' ? 'Nothing needs your attention.' : health.overall.headline}</Text>
                            </Pressable>
                        ) : null}
                    </FadeIn>

                    {need.length ? (
                        <FadeIn index={1}>
                            <SectionTitle section="alerts">Needs you now</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {need.map((a, i) => (
                                    <Pressable key={a.key} onPress={a.go} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.surfaceAlt }}>
                                        <Dot level={a.level} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: t.text, fontWeight: '700' }}>{a.title}</Text>
                                            <Text style={{ color: t.muted, fontSize: font.sm }}>{a.hint}</Text>
                                        </View>
                                        <Text style={{ color: t.muted }}>›</Text>
                                    </Pressable>
                                ))}
                            </Card>
                        </FadeIn>
                    ) : null}

                    {/* this month's money */}
                    {health ? (
                        <FadeIn index={2}>
                            <SectionTitle section="money">Money this month</SectionTitle>
                            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                                <Stat section="money" label="Collected" value={rupees(health.rent.collected)} icon="rupee" onPress={() => nav.navigate('Receivables')} />
                                <Stat section="alerts" label="To collect" value={rupees(health.rent.toCollect)} icon="receipt" onPress={() => nav.navigate('Receivables')} />
                            </View>
                        </FadeIn>
                    ) : null}

                    {/* today */}
                    <FadeIn index={3}>
                        <SectionTitle section="orders">Today</SectionTitle>
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            <Stat section="orders" label="Orders today" value={d.today ? d.today.orders : '—'} icon="orders" />
                            <Stat section="money" label="Sales today" value={d.today ? rupees(d.today.revenue) : '—'} icon="rupee" />
                        </View>
                        {health ? (
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>
                                {`Last 7 days: ${health.orders.last7} orders${health.orders.changePercent !== null ? ` (${health.orders.changePercent >= 0 ? '+' : ''}${health.orders.changePercent}% on the week before)` : ''}`}
                            </Text>
                        ) : null}
                    </FadeIn>

                    {/* the highest Google call use */}
                    {health && topGoogle ? (
                        <FadeIn index={4}>
                            <Card style={{ marginTop: spacing.md }} onPress={goHealth}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    <Dot level={health.google.level} />
                                    <Text style={{ color: t.text, flex: 1 }}>{topGoogle.percent > 0 ? `Google calls: ${topGoogle.label} at ${topGoogle.percent}%` : 'Google calls: no paid calls this month'}</Text>
                                </View>
                            </Card>
                        </FadeIn>
                    ) : null}

                    <FadeIn index={5}>
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

                    <FadeIn index={6}>
                        <SectionTitle section="settings">Quick actions</SectionTitle>
                        <QuickActions
                            items={[
                                { label: 'New shop', icon: 'addCircle', section: 'shops', onPress: () => nav.navigate('ShopsTab', { screen: 'ShopCreate' }) },
                                { label: 'Shop money', icon: 'rupee', section: 'money', onPress: () => nav.navigate('MoreTab', { screen: 'MoneyRecord' }) },
                                { label: 'Brands', icon: 'shops', section: 'platform', onPress: () => nav.navigate('MoreTab', { screen: 'Brands' }) },
                                { label: 'Platform health', icon: 'shield', section: 'alerts', onPress: () => nav.navigate('PlatformHealth') },
                            ]}
                        />
                    </FadeIn>

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

                    {health && health.quiet.quiet > 0 ? (
                        <>
                            <SectionTitle section="alerts">Quiet shops</SectionTitle>
                            <Card onPress={() => nav.navigate('Health')}>
                                <Text style={{ color: t.muted, marginBottom: 4 }}>{health.quiet.note}</Text>
                                {health.quiet.shops.slice(0, 5).map((s) => <Text key={s.id} style={{ color: t.text, paddingVertical: 2 }}>{`• ${s.name}`}</Text>)}
                            </Card>
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
