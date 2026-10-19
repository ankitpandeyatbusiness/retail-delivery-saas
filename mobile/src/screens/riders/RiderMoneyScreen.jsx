// The rider's Money page: the cash he holds, and (only when the shop tracks pay) what he earns. Two cards, plain words.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Card, Stat } from '../../components/owners/ui';
import { BigButton, Banner } from '../../components/riders/riderBits';
import { fetchMoney } from '../../api/riders/riderApi';
import { T, rupee, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

const ago = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

function Line({ title, sub, amount, color }) {
    const { text, muted, border } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: border }}>
            <View style={{ flex: 1 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 14 }}>{title}</Text>
                {sub ? <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{sub}</Text> : null}
            </View>
            <Text style={{ color: color || text, fontWeight: '900', fontSize: 15 }}>{amount}</Text>
        </View>
    );
}

export default function RiderMoneyScreen() {
    const insets = useSafeAreaInsets();
    const { background, text, muted, ok, error, border, primary } = useBrand();
    const [m, setM] = useState(null);
    const [failed, setFailed] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try { setM(await fetchMoney()); setFailed(''); } catch (e) { setFailed(errText(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const cash = m?.cash;
    const limit = cash?.limitPaise || 0;
    const over = limit > 0 && cash?.balancePaise >= limit;
    const near = limit > 0 && !over && cash?.balancePaise >= limit * 0.8;
    const pay = m?.pay;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <ScrollView
                contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: 24, flexGrow: 1 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
            >
                <Text style={{ color: text, fontSize: 22, fontWeight: '900', paddingHorizontal: 16, paddingBottom: 10 }}>{T.money}</Text>
                {!m && !failed ? <ListShimmer count={3} /> : null}
                {failed && !m ? (
                    <View style={{ alignItems: 'center', padding: 30 }}>
                        <Ionicons name="cloud-offline-outline" size={44} color={muted} />
                        <Text style={{ color: text, fontWeight: '800', marginTop: 10 }}>{failed}</Text>
                        <View style={{ marginTop: 14, alignSelf: 'stretch' }}><BigButton label={tr('Try again')} onPress={load} /></View>
                    </View>
                ) : null}

                {m ? (
                    <>
                        {over ? <Banner tone="bad" text={T.cashOverLimit} /> : near ? <Banner tone="warn" text={T.cashNearLimit(rupee(limit))} /> : null}

                        <Card tone={cash.balancePaise > 0 ? '#F59E0B' : undefined}>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{cash.balancePaise > 0 ? T.cashWithYou : T.cashNone}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{rupee(cash.balancePaise)}</Text>
                            {limit > 0 ? (
                                <View style={{ marginTop: 8 }}>
                                    <View style={{ height: 6, borderRadius: 3, backgroundColor: border, overflow: 'hidden' }}>
                                        <View style={{ height: 6, width: `${Math.min(100, Math.round((cash.balancePaise / limit) * 100))}%`, backgroundColor: over ? error : near ? '#F59E0B' : primary }} />
                                    </View>
                                    <Text style={{ color: muted, fontSize: 12, fontWeight: '600', marginTop: 4 }}>{T.cashLimit(rupee(limit))}</Text>
                                </View>
                            ) : null}
                            {cash.balancePaise > 0 ? <Text style={{ color: muted, fontSize: 13, fontWeight: '600', marginTop: 8 }}>{T.cashHint}</Text> : null}
                            {cash.items.length ? (
                                <View style={{ marginTop: 12 }}>
                                    {cash.items.map((r) => (
                                        <Line
                                            key={r.id}
                                            title={r.type === 'collect' ? T.cashCollected(r.orderNo) : r.type === 'handover' ? T.cashHanded : T.cashAdjusted}
                                            sub={ago(r.at) + (r.note ? ` · ${r.note}` : '')}
                                            amount={`${r.amountPaise > 0 ? '+' : '−'}${rupee(Math.abs(r.amountPaise))}`}
                                            color={r.amountPaise > 0 ? '#B45309' : ok}
                                        />
                                    ))}
                                </View>
                            ) : <Text style={{ color: muted, fontSize: 13, marginTop: 10 }}>{T.noCash}</Text>}
                        </Card>

                        {pay && !pay.hidden ? (
                            <Card>
                                <Text style={{ color: text, fontSize: 16, fontWeight: '900' }}>{T.earnings}</Text>
                                <Text style={{ color: muted, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{pay.label}</Text>
                                {pay.earned ? (
                                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                        <Stat label={T.today} value={rupee(pay.earned.todayPaise)} />
                                        <Stat label={T.thisWeek} value={rupee(pay.earned.weekPaise)} />
                                        <Stat label={T.thisMonth} value={rupee(pay.earned.monthPaise)} />
                                    </View>
                                ) : null}
                                {pay.tracked && pay.pendingPaise != null ? (
                                    <View style={{ flexDirection: 'row', marginTop: 10 }}>
                                        <Stat label={T.paid} value={rupee(pay.paidPaise)} color={ok} />
                                        <Stat label={T.toGet} value={rupee(pay.pendingPaise)} color={pay.pendingPaise > 0 ? error : text} />
                                    </View>
                                ) : null}
                                {pay.tracked ? (
                                    <View style={{ marginTop: 12 }}>
                                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{T.payments}</Text>
                                        {pay.payments.filter((p) => !p.voided).length === 0 ? <Text style={{ color: muted, fontSize: 13, marginTop: 6 }}>{T.noPayments}</Text> : null}
                                        {pay.payments.filter((p) => !p.voided).map((p) => (
                                            <Line key={p.id} title={T.payKinds[p.kind] || p.kind} sub={ago(p.paidAt) + (p.note ? ` · ${p.note}` : '')} amount={rupee(p.amountPaise)} color={ok} />
                                        ))}
                                    </View>
                                ) : null}
                            </Card>
                        ) : null}
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}
