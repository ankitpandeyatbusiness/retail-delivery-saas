// Business report: how the shop is doing and what the app does for it. Progress charts (7 days, 30 days, 3 months or a past
// month), what the app brought in, customers, food, delivery partners, and a few plain tips. Opened from Home, the Money tab and
// the menu; the monthly report notification opens it for that month. Opened with params { range? }.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Share } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Pill, Button, Empty, SectionTitle, Stat, money } from '../../components/owners/ui';
import { StatShimmer } from '../../components/owners/shimmer';
import { MoneyRow } from '../../components/owners/moneyBits';
import { SalesChart, HourStrip, HBar } from '../../components/owners/charts';
import { BusySheet } from './ShopHubScreen';
import { fetchBusinessReport, fetchSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';

const lastMonthSpec = () => {
    const ist = new Date(Date.now() + 330 * 60000);
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const TONE = { good: ['checkmark-circle', 'ok'], watch: ['alert-circle', 'warn'], idea: ['bulb', 'primary'] };

function Change({ value, suffix = 'vs before' }) {
    const { ok, error, muted } = useBrand();
    if (value === null || value === undefined) return <Text style={{ color: muted, fontSize: 12 }}>{suffix === 'vs before' ? 'nothing to compare with yet' : ''}</Text>;
    return <Pill label={`${value >= 0 ? '▲' : '▼'} ${Math.abs(value)}% ${suffix}`} color={value >= 0 ? ok : error} />;
}

function Tip({ tip, onAction }) {
    const { text, muted, ok, error, primary, accent } = useBrand();
    const [icon, tone] = TONE[tip.tone] || TONE.idea;
    const color = tone === 'ok' ? ok : tone === 'warn' ? (accent || '#F59E0B') : primary;
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 12 }}>
            <Ionicons name={icon} size={24} color={color} style={{ marginRight: 12, marginTop: 1 }} />
            <View style={{ flex: 1 }}>
                <Text style={{ color: text, fontWeight: '900' }}>{tip.title}</Text>
                <Text style={{ color: muted, marginTop: 3, lineHeight: 20 }}>{tip.detail}</Text>
                {tip.action ? <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Button label={tip.action.label} kind="ghost" onPress={() => onAction(tip.action.screen)} style={{ minHeight: 38, paddingHorizontal: 14 }} /></View> : null}
            </View>
        </View>
    );
}

export default function OwnerBusinessScreen() {
    const nav = useNavigation();
    const given = useRoute().params?.range;
    const { background, text, muted, primary, ok, error } = useBrand();
    const [range, setRange] = useState(given ? String(given) : '30');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [busyOpen, setBusyOpen] = useState(false);
    const [busy, setBusy] = useState(null);
    const prev = lastMonthSpec();
    const options = [['7', '7 days'], ['30', '30 days'], ['90', '3 months'], [prev, 'Last month']];
    if (given && !options.some(([v]) => v === String(given))) options.push([String(given), 'That month']);

    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchBusinessReport(range)); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not make your report.')); }
    }, [range]);
    useEffect(() => { load(); }, [load]);

    const go = (screen) => {
        if (screen === 'Busy') { fetchSettings().then((s) => setBusy(s.orders.busy || null)).catch(() => { }); setBusyOpen(true); return; }
        // a tab lives inside MainTabs; this page sits above the tabs, so go through MainTabs
        if (/Tab$/.test(screen)) nav.navigate('MainTabs', { screen });
        else nav.navigate(screen);
    };
    const share = () => {
        const t = r.totals;
        Share.share({ message: `My shop's progress (${r.range.label}): ₹${Math.round(t.revenue).toLocaleString('en-IN')} from ${t.orders} orders${r.change.revenue !== null ? `, ${r.change.revenue >= 0 ? 'up' : 'down'} ${Math.abs(r.change.revenue)}%` : ''}. ${r.customers.unique} customers, ${r.customers.repeatPct}% came back.` }).catch(() => { });
    };

    const t = r?.totals;
    const maxFood = Math.max(1, ...(r?.food.top || []).map((x) => x.quantity));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxDay = Math.max(1, ...(r?.busiest.byWeekday || [0]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Business report" right={r ? <Ionicons name="share-social" size={22} color={text} onPress={share} /> : null} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 70 }}>
                <View style={{ paddingHorizontal: 16 }}><Chips options={options} value={range} onChange={setRange} style={{ marginTop: 0 }} /></View>
                {!r && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : null}
                {r ? (
                    <>
                        <Card tone={primary}>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{r.range.label}</Text>
                            <Text style={{ color: text, fontSize: 32, fontWeight: '900', marginTop: 2 }}>{money(t.revenue)}</Text>
                            <Text style={{ color: muted, marginTop: 2 }}>from {t.orders} delivered {t.orders === 1 ? 'order' : 'orders'}</Text>
                            <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap' }}><Change value={r.change.revenue} /></View>
                            <View style={{ flexDirection: 'row', marginTop: 14 }}>
                                <Stat label="Average order" value={money(t.avgOrder)} hint={r.change.avgOrder !== null ? `${r.change.avgOrder >= 0 ? '+' : ''}${r.change.avgOrder}%` : undefined} />
                                <Stat label="Customers" value={String(r.customers.unique)} hint={`${r.customers.newCount} new`} />
                                <Stat label="Came back" value={`${r.customers.repeatPct}%`} color={r.customers.repeatPct >= 40 ? ok : undefined} />
                            </View>
                        </Card>

                        {r.milestones.length ? (
                            <Card tone={ok}>
                                {r.milestones.map((m) => (
                                    <View key={m} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
                                        <Ionicons name="trophy" size={20} color={ok} style={{ marginRight: 10 }} />
                                        <Text style={{ color: text, fontWeight: '800', flex: 1 }}>{m}. Well done!</Text>
                                    </View>
                                ))}
                            </Card>
                        ) : null}

                        <SectionTitle title="Your progress" />
                        <Card><SalesChart points={r.series.points} kind={r.series.kind} /></Card>

                        {r.value.show ? (
                            <>
                                <SectionTitle title="What the app brought you" />
                                <Card>
                                    <MoneyRow title="Sales through your app" note={`${r.value.orders} orders`} value={money(r.value.revenue)} color={ok} />
                                    <MoneyRow title="Marketplace commission you avoided" note={`an estimate, at ${r.value.commissionPct}%`} value={money(r.value.marketplaceCost)} />
                                    <MoneyRow title="You paid for the app" value={money(r.value.feeBilled)} />
                                    {r.value.netGain !== null && r.value.feeBilled > 0 ? <MoneyRow title="You kept" note="commission avoided minus what you paid" value={money(r.value.netGain)} color={r.value.netGain >= 0 ? ok : error} /> : null}
                                    {r.value.roi ? <Text style={{ color: primary, fontWeight: '900', marginTop: 6 }}>Every ₹1 you paid brought ₹{Math.round(r.value.roi)} in sales.</Text> : null}
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>Since you joined: {r.value.lifetime.orders.toLocaleString('en-IN')} orders, {money(r.value.lifetime.revenue)} in sales and {r.value.lifetime.customers.toLocaleString('en-IN')} customers who are now YOUR customers, in your own list.</Text>
                                </Card>
                            </>
                        ) : null}

                        {r.tips.length ? (
                            <>
                                <SectionTitle title="What we suggest" />
                                <Card>{r.tips.map((tip, i) => <View key={tip.id} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: alpha(muted, 0.4) }}><Tip tip={tip} onAction={go} /></View>)}</Card>
                            </>
                        ) : null}

                        <SectionTitle title="When you are busy" />
                        <Card>
                            <Text style={{ color: muted, marginBottom: 8 }}>{r.busiest.hourLabel ? `Most orders arrive on ${r.busiest.weekday}, around ${r.busiest.hourLabel}.` : 'Not enough orders yet to tell.'}</Text>
                            <HourStrip byHour={r.busiest.byHour} peak={r.busiest.hour} />
                            <View style={{ height: 12 }} />
                            {days.map((d, i) => <HBar key={d} label={d} value={r.busiest.byWeekday[i]} max={maxDay} right={String(r.busiest.byWeekday[i])} />)}
                        </Card>

                        <SectionTitle title="What customers like" />
                        <Card>
                            {r.food.top.length ? r.food.top.slice(0, 6).map((x) => <HBar key={x.name} label={x.name} value={x.quantity} max={maxFood} right={`${x.quantity} sold · ${money(x.revenue)}`} />) : <Text style={{ color: muted }}>No sales yet.</Text>}
                            {r.food.loved.length ? <Text style={{ color: ok, fontWeight: '800', marginTop: 10 }}>Best rated: {r.food.loved.slice(0, 3).map((x) => `${x.name} (${x.avg}★)`).join(', ')}</Text> : null}
                            {r.food.attention.length ? <Text style={{ color: error, fontWeight: '800', marginTop: 6 }}>Needs a look: {r.food.attention.slice(0, 3).map((x) => `${x.name} (${x.avg}★)`).join(', ')}</Text> : null}
                            {r.food.slow.length ? <Text style={{ color: muted, marginTop: 6 }}>Did not sell: {r.food.slow.map((x) => x.name).join(', ')}</Text> : null}
                        </Card>

                        <SectionTitle title="Your customers" />
                        <Card>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label="Total" value={String(r.customers.unique)} />
                                <Stat label="New" value={String(r.customers.newCount)} color={ok} />
                                <Stat label="Returning" value={String(r.customers.returning)} />
                            </View>
                            {r.customers.top.length ? <Text style={{ color: muted, fontWeight: '700', marginTop: 12, marginBottom: 2 }}>Best customers</Text> : null}
                            {r.customers.top.map((c, i) => <MoneyRow key={String(c.userId)} title={c.name} note={`${c.orders} ${c.orders === 1 ? 'order' : 'orders'}`} value={money(c.spent)} last={i === r.customers.top.length - 1} />)}
                            <View style={{ marginTop: 10 }}><Button label="Open customers" kind="ghost" icon="people" onPress={() => nav.navigate('OwnerCustomers')} /></View>
                        </Card>

                        <SectionTitle title="Delivery" />
                        <Card>
                            {r.delivery.best ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                                    <Ionicons name="ribbon" size={26} color={primary} style={{ marginRight: 10 }} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: text, fontWeight: '900' }}>{r.delivery.best.name} is your best rider</Text>
                                        <Text style={{ color: muted, fontSize: 12 }}>{r.delivery.best.deliveries} deliveries{r.delivery.best.avgMin ? ` · about ${Math.round(r.delivery.best.avgMin)} min each` : ''}{r.delivery.best.rating ? ` · ${r.delivery.best.rating}★` : ''}</Text>
                                    </View>
                                </View>
                            ) : <Text style={{ color: muted }}>No deliveries in this time.</Text>}
                            {r.delivery.riders.slice(1, 5).map((x, i) => <MoneyRow key={String(x.riderId)} title={x.name} note={x.avgMin ? `about ${Math.round(x.avgMin)} min each` : undefined} value={`${x.deliveries}`} last={i === Math.min(r.delivery.riders.length - 1, 4) - 1} />)}
                            {r.delivery.rating.count ? <Text style={{ color: muted, marginTop: 8 }}>Customers rated delivery {r.delivery.rating.avg} of 5 ({r.delivery.rating.count} ratings).</Text> : null}
                        </Card>

                        <SectionTitle title="Orders that did not become sales" />
                        <Card>
                            <MoneyRow title="Cancelled" note={`${t.cancelRate}% of ${t.placed} orders`} value={`${t.cancelled}`} color={t.cancelRate >= 8 ? error : undefined} />
                            <MoneyRow title="Food not sold because of cancellations" value={money(t.cancelledLost)} />
                            <MoneyRow title="Not delivered" value={String(t.undelivered)} />
                            <MoneyRow title="Refunded online" value={money(t.refunds)} />
                            <MoneyRow title="Cash still with riders" value={rupees(r.delivery.cashWithRidersPaise)} last />
                        </Card>

                        <Card tone={primary} style={{ alignItems: 'center' }}>
                            <Ionicons name="sparkles" size={22} color={primary} />
                            <Text style={{ color: text, fontWeight: '800', textAlign: 'center', marginTop: 6, lineHeight: 22 }}>{r.quote}</Text>
                        </Card>
                        <View style={{ paddingHorizontal: 16 }}><Button label="Share my progress" icon="share-social" kind="ghost" onPress={share} /></View>
                    </>
                ) : null}
            </ScrollView>
            <BusySheet visible={busyOpen} busy={busy} onClose={() => setBusyOpen(false)} onChanged={setBusy} />
        </View>
    );
}
