// Closing report: the day in one page (sales, payment split, orders, cash, best sellers). Pick another day, or share it
// as a message (WhatsApp, to a partner or an accountant).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, SectionTitle, Stat, Empty, money } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchClosingReport, fetchProfit, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { closingText } from '../../utils/owners/settingsRules';
import { PAY_LABEL } from '../../utils/owners/moneyRules';
import { rupees } from '../../utils/owners/riderRules';
import { StatShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const istDay = (offset = 0) => new Date(Date.now() + 330 * 60000 - offset * 86400000).toISOString().slice(0, 10);
// the days a choice covers: a single day, or a range (from / to, India dates)
const rangeOf = (which) => {
    if (which === '0' || which === '1' || which === '2') return { date: istDay(Number(which)) };
    if (which === '7') return { from: istDay(6), to: istDay(0) };
    if (which === 'month') return { from: `${istDay(0).slice(0, 8)}01`, to: istDay(0) };
    const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(1); d.setUTCDate(0);   // the last day of last month
    const last = d.toISOString().slice(0, 10);
    return { from: `${last.slice(0, 8)}01`, to: last };
};
const hourName = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const TYPE_NAME = { delivery: 'Home delivery', pickup: 'Pickup', dine_in: 'Dining in' };

export default function OwnerClosingScreen() {
    const { background, text, muted, error, primary } = useBrand();
    const name = useThemeStore((s) => s.theme.name);
    const nav = useNavigation();
    const [which, setWhich] = useState('0');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [pf, setPf] = useState(null);   // profit of the same period: sales minus the costs written down, the rent and the SMS paid

    const load = useCallback(async () => {
        setR(null); setPf(null); setErr('');
        try { const x = rangeOf(which); const rep = await fetchClosingReport(x); setR(rep); const dd = x.date || null; fetchProfit(dd ? { from: dd, to: dd } : x).then(setPf).catch(() => setPf(null)); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not make the report.')); }
    }, [which]);
    useEffect(() => { load(); }, [load]);

    const share = () => Share.share({ message: closingText(r, name) }).catch(() => { });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Closing report')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['0', tr('Today')], ['1', tr('Yesterday')], ['7', tr('7 days')], ['month', tr('This month')], ['lastmonth', tr('Last month')]]} value={which} onChange={setWhich} style={{ marginTop: 0 }} />
                </View>
                {!r && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {r ? (
                    <>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Sales on {date}', { date: r.date })}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(r.sales.revenue)}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                <Stat label={tr('Delivered')} value={String(r.orders.delivered)} />
                                <Stat label={tr('Average order')} value={money(r.sales.averageOrder)} />
                                <Stat label={tr('Tips')} value={money(r.sales.tips)} />
                            </View>
                            {r.sales.bulk?.orders ? <Text style={{ color: muted, marginTop: 12, fontWeight: '700' }}>{tr('Includes bulk orders: {n} · {amount}', { n: r.sales.bulk.orders, amount: money(r.sales.bulk.revenue) })}</Text> : null}
                        </Card>

                        {r.payments.length ? (
                            <>
                                <SectionTitle title={tr('How customers paid')} />
                                <Card>{r.payments.map((p, i) => <MoneyRow key={p.method} title={PAY_LABEL[p.method] || p.method} note={`${p.orders} ${p.orders === 1 ? 'order' : 'orders'}`} value={money(p.total)} last={i === r.payments.length - 1} />)}</Card>
                            </>
                        ) : null}

                        {(() => {
                            const now = r.sales.revenue - (r.sales.bulk?.revenue || 0);
                            if (!r.before || !r.before.revenue) return null;
                            const pct = Math.round(((now - r.before.revenue) / r.before.revenue) * 100);
                            return <Text style={{ color: pct >= 0 ? primary : error, fontWeight: '800', paddingHorizontal: 16, marginTop: 6 }}>{pct >= 0 ? tr('Up {n}%', { n: pct }) : tr('Down {n}%', { n: -pct })} {tr('on the {d} before ({amount})', { d: r.days === 1 ? tr('day') : `${r.days} ${tr('days')}`, amount: money(r.before.revenue) })}</Text>;
                        })()}

                        <SectionTitle title={tr('Orders')} />
                        <Card>
                            <MoneyRow title={tr('Placed')} value={String(r.orders.placed)} />
                            <MoneyRow title={tr('Delivered')} value={String(r.orders.delivered)} />
                            <MoneyRow title={tr('Cancelled')} value={String(r.orders.cancelled)} color={r.orders.cancelled ? error : undefined} note={Object.entries(r.orders.cancelledBy).map(([k, n]) => `${n} by ${k === 'shop' ? 'you' : k}`).join(' · ') || undefined} />
                            <MoneyRow title={tr('Not delivered')} value={String(r.orders.undelivered)} color={r.orders.undelivered ? error : undefined} last />
                        </Card>

                        <SectionTitle title={tr('Tax, discounts and fees')} />
                        <Card>
                            <MoneyRow title={tr('GST in the sales')} note={tr('Collected from customers')} value={money(r.sales.tax)} />
                            <MoneyRow title={tr('Discounts given')} value={money(r.sales.discounts)} />
                            <MoneyRow title={tr('Delivery fees')} value={money(r.sales.deliveryFees)} />
                            <MoneyRow title={tr('Tips')} value={money(r.sales.tips)} last />
                        </Card>

                        {r.hours && r.hours.length ? (
                            <>
                                <SectionTitle title={tr('Busiest hours')} />
                                <Card>{[...r.hours].sort((a, b) => b.sales - a.sales).slice(0, 4).map((h, i, arr) => <MoneyRow key={h.hour} title={`${hourName(h.hour)} - ${hourName((h.hour + 1) % 24)}`} note={`${h.orders} ${h.orders === 1 ? 'order' : 'orders'}`} value={money(h.sales)} last={i === arr.length - 1} />)}</Card>
                            </>
                        ) : null}

                        {r.types && r.types.length ? (
                            <>
                                <SectionTitle title={tr('How orders were served')} />
                                <Card>{r.types.map((x, i) => <MoneyRow key={x.type} title={tr(TYPE_NAME[x.type] || x.type)} note={`${x.orders} ${x.orders === 1 ? 'order' : 'orders'}`} value={money(x.sales)} last={i === r.types.length - 1} />)}</Card>
                            </>
                        ) : null}

                        {r.customers && r.customers.total ? (
                            <>
                                <SectionTitle title={tr('Customers')} />
                                <Card>
                                    <MoneyRow title={tr('Ordered in this time')} value={String(r.customers.total)} />
                                    <MoneyRow title={tr('New customers')} note={tr('First order with you')} value={String(r.customers.new)} />
                                    <MoneyRow title={tr('Came back')} note={tr('Had ordered before')} value={String(r.customers.returning)} last />
                                </Card>
                            </>
                        ) : null}

                        {r.lost && r.lost.orders ? (
                            <>
                                <SectionTitle title={tr('Lost to cancels')} />
                                <Card><MoneyRow title={tr('Orders cancelled or not delivered')} note={`${r.lost.orders} ${r.lost.orders === 1 ? 'order' : 'orders'}`} value={money(r.lost.total)} color={error} last /></Card>
                            </>
                        ) : null}

                        {r.team && (r.team.cooks.length || r.team.riders.length) ? (
                            <>
                                <SectionTitle title={tr('Your team')} />
                                <Card>
                                    {r.team.cooks.map((c, i) => <MoneyRow key={'c' + c.name} title={c.name} note={tr('Cook')} value={`${c.orders} ${tr('orders')}`} last={i === r.team.cooks.length - 1 && !r.team.riders.length} />)}
                                    {r.team.riders.map((x, i) => <MoneyRow key={'r' + x.name + i} title={x.name} note={tr('Rider')} value={`${x.deliveries} ${tr('deliveries')}`} last={i === r.team.riders.length - 1} />)}
                                </Card>
                            </>
                        ) : null}

                        {pf && (pf.costs.total || pf.sales.revenue) ? (
                            <>
                                <SectionTitle title={tr('Profit after costs')} action={tr('Costs')} onAction={() => nav.navigate('OwnerCosts')} />
                                <Card>
                                    <MoneyRow title={tr('Sales')} value={money(pf.sales.revenue)} />
                                    <MoneyRow title={tr('Costs, rent and SMS')} note={pf.costs.total ? undefined : tr('No costs written down yet')} value={`- ${money(pf.costs.total)}`} />
                                    <MoneyRow title={tr('Profit')} value={money(pf.profit)} color={pf.profit >= 0 ? primary : error} last />
                                </Card>
                            </>
                        ) : null}

                        <SectionTitle title={tr('Cash and online')} />
                        <Card>
                            <MoneyRow title={tr('Cash collected by riders')} value={rupees(r.cash.collectedByRidersPaise)} />
                            <MoneyRow title={tr('Still with riders (now)')} note={tr('Collect it before you close')} value={rupees(r.cash.withRidersNowPaise)} color={r.cash.withRidersNowPaise > 0 ? error : undefined} />
                            <MoneyRow title={tr('Received online')} note={tr('{receivedCount} payments', { receivedCount: r.online.receivedCount })} value={rupees(r.online.receivedPaise)} />
                            <MoneyRow title={tr('Refunded online')} note={tr('{refundedCount} refunds', { refundedCount: r.online.refundedCount })} value={rupees(r.online.refundedPaise)} last />
                        </Card>

                        {r.topItems.length ? (
                            <>
                                <SectionTitle title={tr('Best sellers')} />
                                <Card>{r.topItems.map((it, i) => <MoneyRow key={it.name} title={it.name} note={tr('{quantity} sold', { quantity: it.quantity })} value={money(it.revenue)} last={i === r.topItems.length - 1} />)}</Card>
                            </>
                        ) : null}
                        {r.complaints ? <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 12 }}>{tr('{complaints} {v2} came in this day.', { complaints: r.complaints, v2: r.complaints === 1 ? 'complaint' : 'complaints' })}</Text> : null}
                        <View style={{ paddingHorizontal: 16 }}><Button label={tr('Share this report')} icon="share-social" onPress={share} /></View>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
