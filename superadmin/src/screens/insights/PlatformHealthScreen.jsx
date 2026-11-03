import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { fetchPlatformHealth } from '../../api/healthApi';
import { errMsg } from '../../api/adminClient';
import { useLevel, Dot, ShopsDrop, NeedItem } from '../../components/healthBits';
import { toAdmin } from '../../navigation/goTo';

const rs = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
const timeOf = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// one card: a coloured dot and word, the one-line reason, then the numbers
function HealthCard({ title, level, note, onPress, children }) {
    const t = useTheme();
    const L = useLevel()(level);
    return (
        <Card onPress={onPress} style={{ marginBottom: spacing.md, borderLeftWidth: 5, borderLeftColor: L.color }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Dot level={level} />
                    <Text style={{ color: L.color, fontWeight: '800' }}>{L.word}</Text>
                </View>
            </View>
            {note ? <Text style={{ color: t.muted, marginTop: 4 }}>{note}</Text> : null}
            {children ? <View style={{ marginTop: spacing.md }}>{children}</View> : null}
        </Card>
    );
}

const Row = ({ label, value, strong, tone, sub }) => {
    const t = useTheme();
    return (
        <View style={{ paddingVertical: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ color: t.muted, flexShrink: 1, paddingRight: 12 }}>{label}</Text>
                <Text style={{ color: tone || t.text, fontWeight: strong ? '800' : '600', flexShrink: 0, textAlign: 'right' }}>{value}</Text>
            </View>
            {sub ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 1 }}>{sub}</Text> : null}
        </View>
    );
};

function Bar({ percent, level }) {
    const t = useTheme();
    const L = useLevel()(level);
    return (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surfaceAlt, overflow: 'hidden', marginTop: 4 }}>
            <View style={{ width: `${Math.min(100, Math.max(percent > 0 ? 2 : 0, percent))}%`, height: 8, backgroundColor: L.color }} />
        </View>
    );
}

// The platform at a glance: is it running fine, is the money coming in, is anything near a danger line.
export default function PlatformHealthScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const level = useLevel();
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [openNeed, setOpenNeed] = useState(null);    // which "Needs you" line is dropped down

    const load = useCallback(async () => { setErr(''); try { setR(await fetchPlatformHealth()); } catch (e) { setErr(errMsg(e)); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    // where each card's trouble is looked at
    const go = {
        system: () => nav.navigate('System'),
        payments: () => nav.navigate('System'),
        sms: () => toAdmin(nav, { screen: 'MoneyTab', params: { screen: 'SmsProfit' } }),
        rent: () => nav.navigate('Receivables'),
        orders: () => toAdmin(nav, { screen: 'OrdersTab', params: { screen: 'SalesReport' } }),
        google: () => toAdmin(nav, { screen: 'MoreTab', params: { screen: 'LiveTracking' } }),
        shops: () => toAdmin(nav, { screen: 'MoreTab', params: { screen: 'ShopsGrowth' } }),
        support: () => nav.navigate('Support'),
        quiet: () => nav.navigate('Health'),
        versions: undefined,
    };
    const openShop = (x) => toAdmin(nav, { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId: x.id, name: x.name } } });
    const LABEL = { system: 'Server and backup', payments: 'Payment notices', sms: 'SMS', rent: 'Rent', orders: 'Orders', google: 'Google calls', shops: 'Shops', support: 'Support', quiet: 'Quiet shops', versions: 'App versions' };

    const o = r && level(r.overall.level);
    return (
        <Screen title="Platform health" subtitle="Is everything running fine?" onRefresh={load}>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {r ? (
                <>
                    <View style={{ backgroundColor: o.soft, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 2, borderColor: o.color }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Dot level={r.overall.level} size={20} />
                            <Text style={{ color: o.color, fontWeight: '900', fontSize: 24 }}>{r.overall.text}</Text>
                        </View>
                        {r.overall.level !== 'good' ? <Text style={{ color: t.text, marginTop: 6 }}>{r.overall.headline}</Text> : <Text style={{ color: t.muted, marginTop: 6 }}>Nothing needs your attention.</Text>}
                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 6 }}>{`Checked at ${timeOf(r.at)}. Pull down to check again.`}</Text>
                    </View>

                    {r.needsYou.length ? (
                        <>
                            <SectionTitle section="alerts">Needs you</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
                                {r.needsYou.map((x, i) => (
                                    <NeedItem key={x.key} first={i === 0} level={x.level} title={LABEL[x.key]} hint={x.note} list={x.list} total={x.listTotal} max={5}
                                        open={openNeed === x.key} onToggle={() => setOpenNeed(openNeed === x.key ? null : x.key)} onShop={openShop} onOpen={go[x.key]} />
                                ))}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="money">Money</SectionTitle>
                    <HealthCard title="Rent this month" level={r.rent.level} note={r.rent.note} onPress={go.rent}>
                        <Row label="Shops that paid" value={`${r.rent.paidShops} of ${r.rent.billed}`} />
                        <Row label="Total collected" value={rs(r.rent.collected)} strong />
                        <Row label="Shops still to pay" value={num(r.rent.unpaidShops)} />
                        <Row label="Total to collect" value={rs(r.rent.toCollect)} strong />
                        {r.rent.overdueBills ? <Row label="Overdue" value={`${r.rent.overdueBills} bills · ${rs(r.rent.overdueAmount)}`} strong tone={t.danger} /> : null}
                        <ShopsDrop list={r.rent.list} total={r.rent.listTotal} onShop={openShop} max={8} />
                    </HealthCard>
                    <HealthCard title="SMS, last 7 days" level={r.sms.level} note={r.sms.note} onPress={go.sms}>
                        <Row label="SMS sent" value={num(r.sms.sent)} strong />
                        <Row label="We paid the provider" value={`${rs(r.sms.cost)}${r.sms.costPerSms !== null ? ` (${rs(r.sms.costPerSms)} each)` : ''}`} />
                        <Row label="We charged the shops" value={`${rs(r.sms.revenue)}${r.sms.chargedPerSms !== null ? ` (${rs(r.sms.chargedPerSms)} each)` : ''}`} />
                        <Row label="Profit" value={rs(r.sms.profit)} strong tone={r.sms.profit < 0 ? t.danger : t.success} />
                        {r.sms.failed7 ? <Row label="Failed" value={`${num(r.sms.failed7)} (${num(r.sms.failed24h)} in the last day)`} tone={t.warn} /> : null}
                        <ShopsDrop list={r.sms.list} total={r.sms.listTotal} onShop={openShop} max={8} />
                    </HealthCard>

                    <SectionTitle section="orders">Orders</SectionTitle>
                    <HealthCard title="Orders across all shops" level={r.orders.level} note={r.orders.note} onPress={go.orders}>
                        <Row label="Today" value={num(r.orders.today)} strong />
                        <Row label="Last 7 days" value={num(r.orders.last7)} strong sub={r.orders.changePercent !== null ? `${r.orders.changePercent >= 0 ? '+' : ''}${r.orders.changePercent}% on the 7 days before` : undefined} />
                        <Row label="This month so far" value={num(r.orders.thisMonth)} strong sub={r.orders.monthChangePercent !== null ? `${r.orders.monthChangePercent >= 0 ? '+' : ''}${r.orders.monthChangePercent}% on the same days of last month` : undefined} />
                        <Row label="Last month (whole)" value={num(r.orders.lastMonth)} strong />
                        <Row label="Cancelled in 7 days" value={`${num(r.orders.cancelled7)} (${r.orders.cancelRatePercent}%)`} />
                        {r.orders.waitingUnaccepted ? <Row label="Waiting over 10 minutes, not accepted" value={num(r.orders.waitingUnaccepted)} tone={t.warn} strong /> : null}
                        <ShopsDrop list={r.orders.list} total={r.orders.listTotal} onShop={openShop} max={8} />
                    </HealthCard>

                    <SectionTitle section="platform">Google calls this month</SectionTitle>
                    <HealthCard title="Google paid calls" level={r.google.level} note={r.google.note} onPress={go.google}>
                        {r.google.apis.map((a) => (
                            <View key={a.key} style={{ marginBottom: spacing.sm }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                    <Text style={{ color: t.text, flex: 1, paddingRight: 8 }}>{a.label}</Text>
                                    <Text style={{ color: a.level === 'good' ? t.muted : level(a.level).color, fontWeight: '700' }}>{a.off ? 'off' : `${num(a.used)} of ${num(a.cap)} · ${a.percent}%`}</Text>
                                </View>
                                {!a.off ? <Bar percent={a.percent} level={a.level} /> : null}
                            </View>
                        ))}
                        <Text style={{ color: t.muted, fontSize: font.xs }}>{`Not counted here: ${r.google.notMetered.join(', ')}.`}</Text>
                    </HealthCard>

                    <SectionTitle section="shops">Shops</SectionTitle>
                    <HealthCard title="Free and paid shops" level={r.shops.level} note={r.shops.note} onPress={go.shops}>
                        <Row label="Total shops" value={num(r.shops.total)} strong />
                        <Row label="In the free period" value={num(r.shops.free)} />
                        <Row label="Paying" value={num(r.shops.paid)} strong />
                        {r.shops.grace ? <Row label="In grace (bill overdue)" value={num(r.shops.grace)} tone={t.warn} /> : null}
                        {r.shops.paused ? <Row label="Paused for unpaid rent" value={num(r.shops.paused)} tone={t.danger} strong /> : null}
                        <Row label="Not live yet" value={num(r.shops.notLive)} />
                        {r.shops.freeEnding ? <Row label="Free period ends within 7 days" value={num(r.shops.freeEnding)} tone={t.warn} /> : null}
                        <ShopsDrop list={r.shops.list} total={r.shops.listTotal} onShop={openShop} max={8} />
                    </HealthCard>
                    <HealthCard title="Quiet shops" level={r.quiet.level} note={r.quiet.note} onPress={go.quiet}>
                        <ShopsDrop list={r.quiet.list} total={r.quiet.listTotal} onShop={openShop} max={8} />
                    </HealthCard>
                    <HealthCard title="App versions" level={r.versions.level} note={r.versions.note}>
                        <ShopsDrop list={r.versions.list} total={r.versions.listTotal} onShop={openShop} max={8} />
                    </HealthCard>

                    <SectionTitle section="settings">The platform itself</SectionTitle>
                    <HealthCard title="Server and backup" level={r.system.level} note={r.system.note} onPress={go.system}>
                        <Row label="Database" value={r.system.database.ok ? `working (${r.system.database.pingMs} ms)` : 'not answering'} tone={r.system.database.ok ? t.text : t.danger} />
                        <Row label="Last backup" value={r.system.backup.newest ? `${r.system.backup.newest}${r.system.backup.ageDays ? ` (${r.system.backup.ageDays} days ago)` : ' (today)'}` : 'none'} tone={r.system.backup.stale ? t.danger : t.text} />
                        <Row label="Push alerts" value={r.system.pushConfigured ? 'set up' : 'not set up'} />
                        <Row label="Razorpay keys" value={r.system.razorpayKeys ? 'present' : 'missing'} tone={r.system.razorpayKeys ? t.text : t.danger} />
                        <Row label="Running for" value={`${r.system.uptimeHours} hours`} />
                        {r.system.problems.map((p) => <Text key={p} style={{ color: t.danger, marginTop: 4 }}>{p}</Text>)}
                    </HealthCard>
                    <HealthCard title="Payment notices" level={r.payments.level} note={r.payments.note} onPress={go.payments} />
                    <HealthCard title="Support" level={r.support.level} note={r.support.note} onPress={go.support}>
                        <ShopsDrop list={r.support.list} total={r.support.listTotal} onShop={openShop} max={8} />
                    </HealthCard>

                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>{`Not tracked yet: ${r.notTracked.join('; ')}.`}</Text>
                </>
            ) : null}
        </Screen>
    );
}
