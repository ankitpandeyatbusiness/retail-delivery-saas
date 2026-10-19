// One rider's points for the owner: his badge, how far the next one is, and what gave or took points lately.
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { Card, SectionTitle } from './ui';
import { LineShimmer } from './shimmer';
import { RiderBadge } from '../common/RiderBadge';
import { fetchRiderPointsFor } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

const WHY = { delivered: 'Delivery', stars: 'Customer rating', fault: 'Complaint (his fault)', cancel_pickup: 'Cancelled after pickup' };

export default function RiderPointsCard({ userId }) {
    const { text, muted, ok, error, border } = useBrand();
    const [d, setD] = useState(null);
    useFocusEffect(useCallback(() => { fetchRiderPointsFor(userId).then(setD).catch(() => setD((x) => x || { standing: null, history: [] })); }, [userId]));
    if (d && !d.standing) return null;   // the shop does not use rider points
    const st = d?.standing;
    return (
        <View>
            <SectionTitle title={tr('Points and badge')} />
            <Card>
                {!st ? <LineShimmer width={160} height={14} /> : (
                    <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <RiderBadge badge={st.badge} size="lg" />
                            <Text style={{ color: text, fontWeight: '900', fontSize: 22, marginLeft: 12 }}>{st.points}</Text>
                            <Text style={{ color: muted, marginLeft: 6, fontWeight: '600' }}>{tr('points (30 days)')}</Text>
                        </View>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>
                            {st.next
                                ? tr('Next badge: {b}. {n} more points, rating {r}+', { b: tr(st.next.badge.charAt(0).toUpperCase() + st.next.badge.slice(1)), n: st.next.pointsNeeded, r: st.next.rating })
                                : tr('He has the top badge.')}
                        </Text>
                        {d.history.slice(0, 8).map((h, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                                <Text style={{ flex: 1, color: text, fontWeight: '600' }}>{tr(WHY[h.reason] || 'Points')}{h.orderNo ? ` · #${h.orderNo}` : ''}</Text>
                                <Text style={{ color: h.points > 0 ? ok : error, fontWeight: '900' }}>{h.points > 0 ? '+' : ''}{h.points}</Text>
                            </View>
                        ))}
                    </View>
                )}
            </Card>
        </View>
    );
}
