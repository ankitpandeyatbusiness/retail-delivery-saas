import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Stat, SectionTitle, Badge, Button } from '../../components/ui';
import { Collapsible } from '../../components/healthBits';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty, toast } from '../../components/feedback';
import { fetchReceivables, remindShop, remindBrand } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateOnly, ago } from '../../utils/format';
import { toAdmin } from '../../navigation/goTo';

const BUCKETS = {
    notDue: 'Not due yet', d1_7: '1 to 7 days late', d8_30: '8 to 30 days late', d31_60: '31 to 60 days late', d60plus: 'Over 60 days late',
};
const BEHAVIOUR = {
    not_paying: { label: 'Not paying', tone: 'danger' },
    late_now: { label: 'Late now', tone: 'warn' },
    paying_late: { label: 'Pays late', tone: 'warn' },
    on_time: { label: 'Pays on time', tone: 'success' },
    new: { label: 'New', tone: 'neutral' },
};

// "Remind" for one shop: sends the owner a push with the amount and the month. Shows how long ago it was last sent.
function RemindButton({ s, onDone }) {
    const t = useTheme();
    const [busy, setBusy] = useState(false);
    const recent = s.remindedAt && Date.now() - new Date(s.remindedAt).getTime() < 3600000;
    const go = async () => {
        setBusy(true);
        try {
            const r = await remindShop(s.tenantId);
            toast(`Reminder sent to ${r.shopName}: ${rupeesFromPaise(Math.round(r.amount * 100))} for ${r.month}`);
            onDone();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <View style={{ marginTop: spacing.md }}>
            <Button small kind={recent ? 'outline' : 'soft'} icon="bell" title={recent ? 'Reminded just now' : 'Remind to pay'} onPress={go} loading={busy} disabled={recent} />
            {s.remindedAt ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 4, textAlign: 'center' }}>Last reminded {ago(s.remindedAt)}</Text> : null}
        </View>
    );
}

// What a shop owes: amount, bills, how late, how it usually pays
function ShopFigures({ s }) {
    const t = useTheme();
    const b = BEHAVIOUR[s.behaviour] || BEHAVIOUR.new;
    return (
        <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: s.overduePaise ? t.danger : t.text, fontSize: font.xl, fontWeight: '800' }}>{rupeesFromPaise(s.unpaidPaise)}</Text>
                <Badge label={b.label} tone={b.tone} />
            </View>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                {s.invoices} bill(s){s.daysOverdue ? ` · ${s.daysOverdue} days overdue` : ' · not due yet'}{s.oldestDueAt ? ` · oldest due ${dateOnly(s.oldestDueAt)}` : ''}
            </Text>
            <Text style={{ color: t.muted, fontSize: font.sm }}>
                {s.paidCount ? `Paid ${s.paidCount} bill(s) before, on average ${s.avgDaysLate} days late` : 'Has never paid a bill'}
                {s.billingState === 'paused' ? ' · shop is paused' : s.billingState === 'grace' ? ' · in grace period' : ''}
            </Text>
        </>
    );
}

// A brand: one card with the total of its branches; tap to see every branch's bill, each with its own Remind button, and one to remind them all
function BrandCard({ g, onOpenShop, onDone }) {
    const t = useTheme();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const progress = useSharedValue(0);
    useEffect(() => { progress.value = withTiming(open ? 1 : 0, { duration: 280, easing: Easing.out(Easing.cubic) }); }, [open, progress]);
    const arrow = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 90}deg` }] }));
    const all = async () => {
        setBusy(true);
        try {
            const r = await remindBrand(g.brandId);
            const n = r.sent.length;
            toast(n ? `Reminded ${n} branch${n === 1 ? '' : 'es'} of ${r.brandName}${r.skipped.length ? ` (${r.skipped.length} reminded recently)` : ''}` : 'Every branch was reminded in the last hour');
            onDone();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Card style={{ marginBottom: spacing.md }}>
            <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', flex: 1 }} numberOfLines={1}>{g.brandName}</Text>
                    <Badge label={`${g.branches.length} branch${g.branches.length === 1 ? '' : 'es'}`} tone="primary" icon="shops" />
                    <Animated.Text style={[{ color: t.primary, fontSize: font.xl, marginLeft: spacing.sm }, arrow]}>›</Animated.Text>
                </View>
                <Text style={{ color: g.overduePaise ? t.danger : t.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.sm }}>{rupeesFromPaise(g.unpaidPaise)}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{g.overduePaise ? `${rupeesFromPaise(g.overduePaise)} overdue · ` : ''}tap to see each branch</Text>
            </Pressable>
            <Collapsible progress={progress}>
                <View style={{ paddingTop: spacing.md }}>
                    {g.branches.map((s) => (
                        <View key={s.tenantId} style={{ paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: t.border }}>
                            <Pressable onPress={() => onOpenShop(s)} accessibilityRole="button">
                                <Text style={{ color: t.text, fontWeight: '800', marginBottom: 4 }} numberOfLines={1}>{s.name}</Text>
                                <ShopFigures s={s} />
                            </Pressable>
                            <RemindButton s={s} onDone={onDone} />
                        </View>
                    ))}
                    <Button small icon="bell" title={`Remind all ${g.branches.length} branches`} onPress={all} loading={busy} style={{ marginTop: spacing.sm }} />
                </View>
            </Collapsible>
        </Card>
    );
}

// Who owes you rent, how old it is, and who pays late.
export default function ReceivablesScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try { setD(await fetchReceivables()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
    const openShop = (s) => toAdmin(nav, { screen: 'ShopsTab', params: { screen: 'ShopBilling', params: { shopId: String(s.tenantId), name: s.name } } });
    const total = d ? d.totals.buckets.reduce((a, b) => a + b.paise, 0) : 0;
    const rows = useMemo(() => {
        if (!d) return [];
        const brands = new Map(); const out = [];
        for (const s of d.shops) {
            if (!s.brandId) { out.push({ kind: 'shop', key: s.tenantId, s, overduePaise: s.overduePaise, unpaidPaise: s.unpaidPaise }); continue; }
            if (!brands.has(s.brandId)) { const g = { kind: 'brand', key: 'b' + s.brandId, brandId: s.brandId, brandName: s.brandName || 'Brand', branches: [], unpaidPaise: 0, overduePaise: 0 }; brands.set(s.brandId, g); out.push(g); }
            const g = brands.get(s.brandId); g.branches.push(s); g.unpaidPaise += s.unpaidPaise; g.overduePaise += s.overduePaise;
        }
        return out.sort((a, b) => b.overduePaise - a.overduePaise || b.unpaidPaise - a.unpaidPaise);
    }, [d]);

    return (
        <Screen title="Who owes you" subtitle="Unpaid rent and payment habits" refreshing={refreshing} onRefresh={refresh}>
            {error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <Stat section={d.totals.overduePaise ? 'alerts' : 'money'} label="Overdue" value={rupeesFromPaise(d.totals.overduePaise)} icon="warning" />
                        <Stat label="All unpaid" value={rupeesFromPaise(d.totals.pendingPaise)} icon="receipt" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Shops overdue" value={String(d.totals.overdueShops)} icon="shops" tone={d.totals.overdueShops ? 'warn' : undefined} />
                        <Stat label="Never paid" value={String(d.totals.neverPaid)} icon="block" tone={d.totals.neverPaid ? 'danger' : undefined} />
                    </View>

                    {total > 0 ? (
                        <>
                            <SectionTitle section="alerts">How old is the unpaid money</SectionTitle>
                            <Card>
                                {d.totals.buckets.map((b, i) => {
                                    const pct = total ? Math.max(b.paise ? 4 : 0, Math.round((b.paise / total) * 100)) : 0;
                                    return (
                                        <View key={b.key} style={{ marginBottom: i === 4 ? 0 : spacing.md }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{BUCKETS[b.key]}</Text>
                                                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '800' }}>{rupeesFromPaise(b.paise)}</Text>
                                            </View>
                                            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surfaceAlt, marginTop: 6 }}>
                                                <View style={{ height: 8, borderRadius: 4, width: `${pct}%`, backgroundColor: b.key === 'notDue' ? t.info : b.key === 'd1_7' ? t.warn : t.danger }} />
                                            </View>
                                        </View>
                                    );
                                })}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="people">Shops that owe you</SectionTitle>
                    {rows.length === 0 ? <Empty icon="ok" title="Nobody owes you anything" hint="All rent bills are paid." /> : rows.map((r) => (r.kind === 'brand'
                        ? <BrandCard key={r.key} g={r} onOpenShop={openShop} onDone={load} />
                        : (
                            <Card key={r.key} onPress={() => openShop(r.s)} style={{ marginBottom: spacing.md }}>
                                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', marginBottom: spacing.xs }} numberOfLines={1}>{r.s.name}</Text>
                                <ShopFigures s={r.s} />
                                <RemindButton s={r.s} onDone={load} />
                            </Card>
                        )))}

                    {d.behaviour.length ? (
                        <>
                            <SectionTitle section="riders">Payment habits (shops that paid before)</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {d.behaviour.map((s, i) => (
                                    <View key={s.tenantId} style={{ paddingVertical: spacing.md, borderBottomWidth: i === d.behaviour.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ color: t.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{s.name}</Text>
                                            <Text style={{ color: s.avgDaysLate > 0 ? t.warn : t.success, fontWeight: '800' }}>{s.avgDaysLate > 0 ? `${s.avgDaysLate} days late` : 'On time'}</Text>
                                        </View>
                                        <Text style={{ color: t.muted, fontSize: font.sm }}>{s.paidCount} paid · {s.onTimeRate}% on time{s.lastPaidAt ? ` · last paid ${dateOnly(s.lastPaidAt)}` : ''}</Text>
                                    </View>
                                ))}
                            </Card>
                        </>
                    ) : null}
                </>
            )}
        </Screen>
    );
}
