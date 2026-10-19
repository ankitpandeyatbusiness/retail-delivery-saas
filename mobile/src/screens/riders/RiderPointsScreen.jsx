// The rider's points and badge: where he stands, how far the next badge is, what earns and loses points, and his last lines.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { RiderBadge, BADGES } from '../../components/common/RiderBadge';
import { fetchRiderPoints } from '../../api/riders/riderApi';
import { tr } from '../../i18n';

const WHY = { delivered: 'Delivery', stars: 'Customer rating', fault: 'Complaint (your fault)', cancel_pickup: 'Cancelled after pickup' };
const when = (at) => new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function RiderPointsScreen() {
    const { background, text, muted, primary, ok, error, border } = useBrand();
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => { try { setD(await fetchRiderPoints()); } catch (e) { setD((x) => x || { enabled: false, failed: true }); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!d) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('My points and badge')} /><ListShimmer count={3} /></View>;
    if (!d.enabled) {
        return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('My points and badge')} /><Text style={{ color: muted, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 }}>{d.failed ? tr('Could not load. Pull down to try again.') : tr('Your shop does not use rider points yet.')}</Text></View>;
    }
    const r = d.rules;
    const next = d.next;
    const bar = next ? Math.max(0.04, Math.min(1, d.points / (d.points + next.pointsNeeded))) : 1;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My points and badge')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={async () => { setBusy(true); await load(); setBusy(false); }} />}>
                <Card tone={BADGES[d.badge]?.color}>
                    <RiderBadge badge={d.badge} size="lg" />
                    <Text style={{ color: text, fontSize: 40, fontWeight: '900', marginTop: 8 }}>{d.points}</Text>
                    <Text style={{ color: muted, fontWeight: '700' }}>{tr('points in the last 30 days')}</Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>
                        {d.rated > 0 ? `★ ${Number(d.rating).toFixed(1)} · ${tr('{n} rated deliveries', { n: d.rated })}` : tr('No rated deliveries yet')} · {tr('{n} deliveries', { n: d.deliveries })}
                    </Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('Customers and your shop can see your badge.')}</Text>
                </Card>

                <Card>
                    {next ? (
                        <View>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Next: {badge}', { badge: tr(BADGES[next.badge].label) })} {BADGES[next.badge].icon}</Text>
                            <View style={{ height: 10, borderRadius: 5, backgroundColor: alpha(muted, 0.2), marginTop: 10, overflow: 'hidden' }}>
                                <View style={{ width: `${bar * 100}%`, height: '100%', backgroundColor: BADGES[next.badge].color }} />
                            </View>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>
                                {[
                                    next.pointsNeeded > 0 ? tr('{n} more points', { n: next.pointsNeeded }) : null,
                                    d.rating < next.rating ? tr('rating {r} or more', { r: next.rating }) : null,
                                    d.needRated > 0 ? tr('{n} more rated deliveries', { n: d.needRated }) : null,
                                ].filter(Boolean).join(' · ') || tr('You are almost there!')}
                            </Text>
                        </View>
                    ) : <Text style={{ color: ok, fontWeight: '900' }}>{tr('You have the top badge. Great work!')}</Text>}
                </Card>

                <SectionTitle title={tr('What gives points')} />
                <Card>
                    {[
                        [tr('Every delivery'), `+${r.perDelivery}`],
                        [tr('Delivered on time'), `+${r.onTime}`],
                        ...[5, 4, 3, 2, 1].map((s) => [tr('{s} star rating', { s }), `${r.stars[s] > 0 ? '+' : ''}${r.stars[s]}`]),
                        [tr('Complaint decided as your fault'), `${r.fault}`],
                        [tr('Cancelled after collecting the food'), `${r.cancelAfterPickup}`],
                    ].map(([label, pts], i) => (
                        <View key={i} style={{ flexDirection: 'row', paddingVertical: 6 }}>
                            <Text style={{ flex: 1, color: text, fontWeight: '600' }}>{label}</Text>
                            <Text style={{ color: String(pts).startsWith('-') ? error : ok, fontWeight: '900' }}>{pts}</Text>
                        </View>
                    ))}
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('A slow trip never takes points away.')}</Text>
                </Card>

                {d.history.length ? <SectionTitle title={tr('Recent')} /> : null}
                {d.history.length ? (
                    <Card>
                        {d.history.map((h, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(border, 0.7) }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '700' }}>{tr(WHY[h.reason] || 'Points')}{h.orderNo ? ` · #${h.orderNo}` : ''}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{when(h.at)}{h.note ? ` · ${h.note}` : ''}</Text>
                                </View>
                                <Text style={{ color: h.points > 0 ? ok : error, fontWeight: '900', fontSize: 16 }}>{h.points > 0 ? '+' : ''}{h.points}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}
            </ScrollView>
        </View>
    );
}
