// Closing report: the day in one page (sales, payment split, orders, cash, best sellers). Pick another day, or share it
// as a message (WhatsApp, to a partner or an accountant).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Share } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, SectionTitle, Stat, Empty, money } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchClosingReport, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { closingText } from '../../utils/owners/settingsRules';
import { PAY_LABEL } from '../../utils/owners/moneyRules';
import { rupees } from '../../utils/owners/riderRules';
import { StatShimmer } from '../../components/owners/shimmer';

const istDay = (offset = 0) => new Date(Date.now() + 330 * 60000 - offset * 86400000).toISOString().slice(0, 10);

export default function OwnerClosingScreen() {
    const { background, text, muted, error, primary } = useBrand();
    const name = useThemeStore((s) => s.theme.name);
    const [which, setWhich] = useState('0');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchClosingReport({ date: istDay(Number(which)) })); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not make the report.')); }
    }, [which]);
    useEffect(() => { load(); }, [load]);

    const share = () => Share.share({ message: closingText(r, name) }).catch(() => { });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Closing report" />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['0', 'Today'], ['1', 'Yesterday'], ['2', istDay(2).slice(5).split('-').reverse().join('/')]]} value={which} onChange={setWhich} style={{ marginTop: 0 }} />
                </View>
                {!r && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : null}
                {r ? (
                    <>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>Sales on {r.date}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(r.sales.revenue)}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                <Stat label="Delivered" value={String(r.orders.delivered)} />
                                <Stat label="Average order" value={money(r.sales.averageOrder)} />
                                <Stat label="Tips" value={money(r.sales.tips)} />
                            </View>
                        </Card>

                        {r.payments.length ? (
                            <>
                                <SectionTitle title="How customers paid" />
                                <Card>{r.payments.map((p, i) => <MoneyRow key={p.method} title={PAY_LABEL[p.method] || p.method} note={`${p.orders} ${p.orders === 1 ? 'order' : 'orders'}`} value={money(p.total)} last={i === r.payments.length - 1} />)}</Card>
                            </>
                        ) : null}

                        <SectionTitle title="Orders" />
                        <Card>
                            <MoneyRow title="Placed" value={String(r.orders.placed)} />
                            <MoneyRow title="Delivered" value={String(r.orders.delivered)} />
                            <MoneyRow title="Cancelled" value={String(r.orders.cancelled)} color={r.orders.cancelled ? error : undefined} note={Object.entries(r.orders.cancelledBy).map(([k, n]) => `${n} by ${k === 'shop' ? 'you' : k}`).join(' · ') || undefined} />
                            <MoneyRow title="Not delivered" value={String(r.orders.undelivered)} color={r.orders.undelivered ? error : undefined} last />
                        </Card>

                        <SectionTitle title="Cash and online" />
                        <Card>
                            <MoneyRow title="Cash collected by riders" value={rupees(r.cash.collectedByRidersPaise)} />
                            <MoneyRow title="Still with riders (now)" note="Collect it before you close" value={rupees(r.cash.withRidersNowPaise)} color={r.cash.withRidersNowPaise > 0 ? error : undefined} />
                            <MoneyRow title="Received online" note={`${r.online.receivedCount} payments`} value={rupees(r.online.receivedPaise)} />
                            <MoneyRow title="Refunded online" note={`${r.online.refundedCount} refunds`} value={rupees(r.online.refundedPaise)} last />
                        </Card>

                        {r.topItems.length ? (
                            <>
                                <SectionTitle title="Best sellers" />
                                <Card>{r.topItems.map((it, i) => <MoneyRow key={it.name} title={it.name} note={`${it.quantity} sold`} value={money(it.revenue)} last={i === r.topItems.length - 1} />)}</Card>
                            </>
                        ) : null}
                        {r.complaints ? <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 12 }}>{r.complaints} {r.complaints === 1 ? 'complaint' : 'complaints'} came in this day.</Text> : null}
                        <View style={{ paddingHorizontal: 16 }}><Button label="Share this report" icon="share-social" onPress={share} /></View>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
