import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FadeIn, animateNext } from '../../components/motion';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Stat, Card, Button, SectionTitle } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import SearchResults from '../../components/SearchResults';
import { ShopRow } from '../../components/shopBits';
import { QuickActions, StatStrip, RankRow, SkeletonBar } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { Dot, useLevel, NeedItem } from '../../components/healthBits';
import { useDashboardStore } from '../../store/useDashboardStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useSupreme } from '../../hooks/useSupreme';
import { rupees } from '../../utils/format';
import { fetchSupportCounts } from '../../api/supportApi';
import { fetchPlatformHealth } from '../../api/healthApi';
import { fetchMoneyRecord } from '../../api/moneyRecordApi';
import { goTab } from '../../navigation/goTo';

const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const monthOf = (plus = 0) => { const x = new Date(Date.now() + 330 * 60000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + plus, 1)).toISOString().slice(0, 7); };
const LABEL = { system: 'Server and backup', payments: 'Payment notices', sms: 'SMS', rent: 'Plans', orders: 'Orders', google: 'Google calls', shops: 'Shops', support: 'Support', quiet: 'Quiet shops', versions: 'App versions' };

// What Home looks like while it loads: ONE shimmer for the whole page (the platform light, Needs you, money, today), shown until both the shop numbers and the health numbers are in.
function HomeSkeleton() {
    return (
        <View>
            <SkeletonBar height={84} radiusPx={16} />
            <SkeletonBar height={20} width="40%" style={{ marginTop: spacing.xl }} />
            <SkeletonBar height={150} radiusPx={radius.lg} style={{ marginTop: spacing.md }} />
            <SkeletonBar height={20} width="45%" style={{ marginTop: spacing.xl }} />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
            </View>
            <SkeletonBar height={20} width="30%" style={{ marginTop: spacing.xl }} />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
            </View>
        </View>
    );
}

// The platform at a glance: is it fine, what needs you, this month's money, today's orders, and shortcuts to the common jobs.
export default function DashboardScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const level = useLevel();
    const supreme = useSupreme();
    const d = useDashboardStore();
    const admin = useAuthStore((s) => s.admin);

    const [q, setQ] = useState('');                   // the search box: while something is typed, the home screen gives way to the answers
    const searching = q.trim().length > 0;
    const [openNeed, setOpenNeed] = useState(null);    // which "Needs you now" line is dropped down (one at a time)
    const [helpOpen, setHelpOpen] = useState(0);
    const [health, setHealth] = useState(null);
    const [healthFailed, setHealthFailed] = useState(false);   // the health numbers could not be read: show the rest of Home anyway
    const [money, setMoney] = useState(null);          // this month's shop money
    const [lastOpen, setLastOpen] = useState(0);       // last month's shops the developer has not answered yet
    useFocusEffect(useCallback(() => {
        // coming back to a screen that already has its numbers: refresh them AFTER the slide has finished, so the slide is not stuttering under network work
        const had = !!useDashboardStore.getState().shops;
        const timer = setTimeout(() => {
            useDashboardStore.getState().load({ refresh: !!useDashboardStore.getState().shops });
            fetchSupportCounts().then((c) => setHelpOpen(c.open || 0)).catch(() => { });
            fetchPlatformHealth().then((x) => { setHealth(x); setHealthFailed(false); }).catch(() => setHealthFailed(true));
            fetchMoneyRecord(monthOf()).then(setMoney).catch(() => { });
            fetchMoneyRecord(monthOf(-1)).then((m) => setLastOpen(m.totals.open + m.totals.again)).catch(() => { });
        }, had ? 450 : 0);
        return () => clearTimeout(timer);
    }, []));

    const first = d.shops === null && d.loading;
    const loadingHome = first || (!health && !healthFailed && !(d.error && d.shops === null));   // one shimmer until everything is in
    const goShops = (params) => nav.navigate('ShopsTab', params ? { screen: 'ShopsList', params } : undefined);
    const goHealth = () => nav.navigate('PlatformHealth');
    const openShop = (x) => goTab(nav, 'ShopsTab', { screen: 'ShopDetail', params: { shopId: x.id, name: x.name } });
    const inHealth = (key) => !!health?.needsYou.some((x) => x.key === key);

    // what needs you now: the health cards that are not green, plus the small things the health screen does not carry
    const need = [
        ...(health ? health.needsYou.slice(0, 5).map((x) => ({ key: x.key, level: x.level, title: LABEL[x.key], hint: x.note, go: goHealth, list: x.list, total: x.listTotal })) : []),
        supreme && lastOpen > 0 && { key: 'answers', level: 'warn', title: 'Shop money to answer', hint: `${lastOpen} shop${lastOpen === 1 ? '' : 's'} of last month: did you get your part?`, go: () => nav.navigate('MoneyRecord') },
        !inHealth('support') && helpOpen > 0 && { key: 'help', level: 'warn', title: `${helpOpen} support request${helpOpen > 1 ? 's' : ''} waiting`, hint: 'Shop owners are waiting for your reply', go: () => nav.navigate('Support') },
        d.unreadAlerts > 0 && { key: 'alerts', level: 'warn', title: `${d.unreadAlerts} unread alert${d.unreadAlerts > 1 ? 's' : ''}`, hint: 'Late orders and platform messages', go: () => nav.navigate('Inbox') },
    ].filter(Boolean);

    // sections that appear or disappear let their neighbours glide
    const shape = `${d.attention.length}-${d.today?.topShops?.length || 0}`;   // (the health blocks come in from their shimmer, not by gliding)
    const lastShape = useRef(shape);
    if (lastShape.current !== shape) { lastShape.current = shape; animateNext(); }
    const wasSearching = useRef(false);
    if (wasSearching.current !== searching) { wasSearching.current = searching; animateNext(); }

    const o = health && level(health.overall.level);
    const topGoogle = health && [...health.google.apis].sort((a, b) => b.percent - a.percent)[0];

    return (
        <Screen
            tabScreen
            title={greeting()}
            subtitle={admin?.name || 'Platform overview'}
            refreshing={d.refreshing}
            onRefresh={() => { d.load({ refresh: true }); fetchPlatformHealth().then((x) => { setHealth(x); setHealthFailed(false); }).catch(() => setHealthFailed(true)); }}
        >
            {/* the search box: type here and the home screen gives way to the matching records; clear it and the home comes back */}
            <View style={{ marginBottom: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Search" />
            </View>

            {searching ? <FadeIn index={0}><SearchResults q={q} /></FadeIn> : null}
            {searching ? null : loadingHome ? <HomeSkeleton /> : d.error && d.shops === null ? (
                <ErrorBox message={d.error} onRetry={() => d.load()} />
            ) : d.shops && d.shops.total === 0 ? (
                <>
                    <Empty icon="shops" title="No shops yet" hint="Create your first shop to start taking orders on the platform." />
                    <Button title="Add the first shop" icon="addCircle" onPress={() => nav.navigate('ShopCreate')} />
                </>
            ) : (
                <>
                    {/* the platform light */}
                    <FadeIn index={0}>
                        {health ? (
                            <Pressable onPress={goHealth} accessibilityRole="button" style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }], backgroundColor: o.soft, borderRadius: 16, padding: spacing.lg, borderWidth: 2, borderColor: o.color })}>
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
                                    <NeedItem key={a.key} first={i === 0} level={a.level} title={a.title} hint={a.hint} list={a.list} total={a.total} max={5}
                                        open={openNeed === a.key} onToggle={() => setOpenNeed(openNeed === a.key ? null : a.key)} onShop={openShop} onOpen={a.go} />
                                ))}
                            </Card>
                        </FadeIn>
                    ) : null}

                    {/* this month's money */}
                    {health ? (
                        <FadeIn index={2}>
                            <SectionTitle section="money">Money this month</SectionTitle>
                            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                                <Stat section="money" label="Collected" value={rupees(health.rent.collected)} icon="rupee" onPress={() => nav.navigate('Ledger')} />
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
                                {`Last 7 days: ${health.orders.last7} orders${health.orders.changePercent !== null ? ` (${health.orders.changePercent >= 0 ? '+' : ''}${health.orders.changePercent}% on the week before)` : ''}
This month so far: ${health.orders.thisMonth} orders${health.orders.monthChangePercent !== null ? ` (${health.orders.monthChangePercent >= 0 ? '+' : ''}${health.orders.monthChangePercent}% on the same days of last month)` : ''}. Last month: ${health.orders.lastMonth}.`}
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
                                { label: 'Closed', value: d.shops ? d.shops.suspended : '—', section: 'platform', onPress: () => goShops({ filter: 'suspended' }) },
                            ]}
                        />
                    </FadeIn>

                    <FadeIn index={6}>
                        <SectionTitle section="settings">Quick actions</SectionTitle>
                        <QuickActions
                            items={[
                                { label: 'New shop', icon: 'addCircle', section: 'shops', onPress: () => nav.navigate('ShopCreate') },
                                { label: 'Shop money', icon: 'rupee', section: 'money', onPress: () => nav.navigate('MoneyRecord') },
                                { label: 'Brands', icon: 'shops', section: 'platform', onPress: () => nav.navigate('Brands') },
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
                                    onPress={() => goTab(nav, 'ShopsTab', { screen: 'ShopDetail', params: { shopId: s._id, name: s.name } })}
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
