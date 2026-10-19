// On the rider's Home screen, when he is NOT on a delivery: the ratings customers gave him, what they did to his points, and how far
// the next badge is. It waits while he is carrying an order and shows when he is free; "Got it" closes it until the next rating.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { BADGES, RiderBadge } from '../common/RiderBadge';
import { tr } from '../../i18n';

export default function RatingNews({ news, onClose }) {
    const { text, muted, ok, error, surface, border } = useBrand();
    if (!news?.items?.length) return null;
    const st = news.standing;
    const total = news.items.reduce((n, i) => n + (i.points || 0), 0);
    const next = st?.next;
    return (
        <View style={{ marginHorizontal: 16, marginBottom: 14, borderRadius: 22, borderWidth: 1, borderColor: alpha(ok, 0.45), backgroundColor: surface, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="star" size={20} color="#F5A623" />
                <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16, marginLeft: 8 }}>
                    {news.items.length === 1 ? tr('A customer rated your delivery') : tr('{n} customers rated your deliveries', { n: news.items.length })}
                </Text>
            </View>
            {news.items.map((i, k) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        {[1, 2, 3, 4, 5].map((s) => <Ionicons key={s} name={i.rating >= s ? 'star' : 'star-outline'} size={17} color={i.rating >= s ? '#F5A623' : muted} />)}
                        {i.orderNo ? <Text style={{ color: muted, fontSize: 12.5, marginLeft: 8 }}>#{i.orderNo}</Text> : null}
                    </View>
                    <Text style={{ color: i.points >= 0 ? ok : error, fontWeight: '900' }}>{i.points > 0 ? '+' : ''}{i.points} {tr('points')}</Text>
                </View>
            ))}
            {st ? (
                <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <RiderBadge badge={st.badge} />
                        <Text style={{ color: text, fontWeight: '900', marginLeft: 10 }}>{tr('{n} points', { n: st.points })}</Text>
                        {total !== 0 ? <Text style={{ color: total > 0 ? ok : error, fontWeight: '800', marginLeft: 8 }}>({total > 0 ? '+' : ''}{total})</Text> : null}
                    </View>
                    <Text style={{ color: muted, fontSize: 13, marginTop: 8 }}>
                        {next
                            ? [
                                next.pointsNeeded > 0 ? tr('{n} more points to {badge} {icon}', { n: next.pointsNeeded, badge: tr(BADGES[next.badge].label), icon: BADGES[next.badge].icon }) : tr('Almost at {badge} {icon}', { badge: tr(BADGES[next.badge].label), icon: BADGES[next.badge].icon }),
                                st.rating < next.rating ? tr('and a rating of {r}', { r: next.rating }) : null,
                            ].filter(Boolean).join(' ')
                            : tr('You have the top badge. Great work!')}
                    </Text>
                </View>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 12 }}>
                <Text style={{ color: ok, fontWeight: '900' }}>{tr('Got it')}</Text>
            </Pressable>
        </View>
    );
}
