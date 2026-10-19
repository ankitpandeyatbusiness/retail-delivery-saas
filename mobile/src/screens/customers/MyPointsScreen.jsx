// "My points": the balance, the points on the way (with the time they arrive), how to earn and use them, and the history.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchPoints } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

export const arriveText = (at) => {
    const d = new Date(at);
    const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    const day = d.toDateString() === new Date().toDateString() ? tr('today') : d.toDateString() === new Date(Date.now() + 86400000).toDateString() ? tr('tomorrow') : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `${t} ${day}`;
};
const LEVEL = { member: { icon: '⭐', label: 'Member', color: '#8A8F98' }, silver: { icon: '🥈', label: 'Silver', color: '#7B8794' }, gold: { icon: '🥇', label: 'Gold', color: '#D99A00' }, platinum: { icon: '💎', label: 'Platinum', color: '#5B6CF0' } };
const rs = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const WHY = { order: 'Order delivered', first: 'First order bonus', review_food: 'Food review', review_delivery: 'Delivery review', redeem: 'Used on an order', return: 'Returned: order cancelled', expire: 'Expired' };

export default function MyPointsScreen() {
    const { background, text, muted, primary, ok, border, warn } = useBrand();
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => { try { setD(await fetchPoints()); } catch (e) { setD((x) => x || { enabled: false, failed: true }); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setBusy(true); await load(); setBusy(false); };

    if (!d) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('My points')} /><ListShimmer count={3} /></View>;
    if (!d.enabled) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('My points')} />
                <Text style={{ color: muted, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 }}>{d.failed ? tr('Could not load your points. Pull down to try again.') : tr('This shop does not give points yet.')}</Text>
            </View>
        );
    }
    const r = d.rules;
    const rupees = Math.floor(d.balance / r.pointsPerRupee);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My points')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}>
                <Card tone={primary}>
                    <Text style={{ color: muted, fontWeight: '700', fontSize: 12 }}>{tr('YOUR POINTS')}</Text>
                    <Text style={{ color: text, fontSize: 40, fontWeight: '900', marginTop: 2 }}>{d.balance}</Text>
                    <Text style={{ color: ok, fontWeight: '800', marginTop: 2 }}>{tr('Worth ₹{n} off your next order', { n: rupees })}</Text>
                    {d.balance < r.minRedeem ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('You can use points once you have {n}.', { n: r.minRedeem })}</Text> : null}
                </Card>

                {d.level ? (
                    <Card tone={LEVEL[d.level.name].color}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ fontSize: 30 }}>{LEVEL[d.level.name].icon}</Text>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={{ color: LEVEL[d.level.name].color, fontWeight: '900', fontSize: 18 }}>{tr(LEVEL[d.level.name].label)} {tr('level')}</Text>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
                                    {d.level.bonusPct ? tr('{n}% extra points on every order', { n: d.level.bonusPct }) : tr('Order more to reach Silver')}
                                </Text>
                            </View>
                        </View>
                        {d.level.next ? (
                            <View style={{ marginTop: 12 }}>
                                <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(muted, 0.2), overflow: 'hidden' }}>
                                    <View style={{ width: `${Math.max(4, Math.min(100, (d.level.spend / (d.level.spend + d.level.next.spendNeeded)) * 100))}%`, height: '100%', backgroundColor: LEVEL[d.level.next.name].color }} />
                                </View>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>
                                    {tr('Spend {amount} more to reach {level} ({n}% extra points)', { amount: rs(d.level.next.spendNeeded), level: tr(LEVEL[d.level.next.name].label), n: d.level.next.bonusPct })}
                                </Text>
                            </View>
                        ) : <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{tr('You have the top level. Thank you!')}</Text>}
                        <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('Based on what you spent on food in the last 12 months: {amount}', { amount: rs(d.level.spend) })}</Text>
                    </Card>
                ) : null}

                {d.pending.points > 0 ? (
                    <Card tone={warn}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="time" size={22} color={warn} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: text, fontWeight: '900' }}>{tr('{n} points on the way', { n: d.pending.points })}</Text>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('They reach you by {time}', { time: arriveText(d.pending.nextAt) })}</Text>
                            </View>
                        </View>
                        {d.pending.items.length > 1 ? d.pending.items.map((p, i) => (
                            <Text key={i} style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>+{p.points} · {arriveText(p.at)}</Text>
                        )) : null}
                    </Card>
                ) : null}

                <SectionTitle title={tr('How to earn')} />
                <Card>
                    {[
                        ['restaurant', tr('{n} point for every ₹10 you spend on food', { n: r.perTen })],
                        r.firstOrder > 0 ? ['gift', tr('{n} bonus points on your first order', { n: r.firstOrder })] : null,
                        r.foodReview > 0 ? ['star', tr('{n} points for reviewing the food', { n: r.foodReview })] : null,
                        r.deliveryReview > 0 ? ['bicycle', tr('{n} points for rating the delivery', { n: r.deliveryReview })] : null,
                    ].filter(Boolean).map(([icon, line], i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7 }}>
                            <Ionicons name={icon} size={18} color={primary} />
                            <Text style={{ flex: 1, color: text, marginLeft: 10, fontWeight: '600' }}>{line}</Text>
                        </View>
                    ))}
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>
                        {tr('Points reach you {h} hours after the order is delivered, so a refund never takes them back.', { h: r.holdHours })}
                    </Text>
                </Card>

                <SectionTitle title={tr('How to use')} />
                <Card>
                    <Text style={{ color: text, fontWeight: '700' }}>{tr('{points} points = ₹{rupees} off', { points: r.pointsPerRupee * 10, rupees: 10 })}</Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>
                        {tr('Turn on "Use points" in your cart. Points can pay up to {p}% of the food bill. Points last {m} months.', { p: r.maxPercent, m: r.expiryMonths })}
                    </Text>
                </Card>

                {d.history.length ? <SectionTitle title={tr('History')} /> : null}
                {d.history.length ? (
                    <Card>
                        {d.history.map((h, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(border, 0.7) }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '700' }}>{tr(WHY[h.reason] || h.note || 'Points')}{h.orderNo ? ` · #${h.orderNo}` : ''}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{h.pending ? tr('Arrives {time}', { time: arriveText(h.at) }) : arriveText(h.at)}</Text>
                                </View>
                                <Text style={{ color: h.pending ? warn : h.points > 0 ? ok : text, fontWeight: '900', fontSize: 16 }}>{h.points > 0 ? '+' : ''}{h.points}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}
            </ScrollView>
        </View>
    );
}
