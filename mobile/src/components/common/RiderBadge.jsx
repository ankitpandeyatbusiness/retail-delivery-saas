// A delivery partner's badge: Bronze, Silver, Gold or Platinum. Shown to customers, the shop and the rider himself.
//   <RiderBadge badge="gold" />                a small pill
//   <RiderStanding standing={...} />           "Gold · ★4.8 · 312 deliveries" as one line (customer's tracking card)
import React from 'react';
import { View, Text } from 'react-native';
import { alpha } from './kit';
import { tr } from '../../i18n';

export const BADGES = {
    bronze: { label: 'Bronze', icon: '🥉', color: '#B4691F' },
    silver: { label: 'Silver', icon: '🥈', color: '#7B8794' },
    gold: { label: 'Gold', icon: '🥇', color: '#D99A00' },
    platinum: { label: 'Platinum', icon: '💎', color: '#5B6CF0' },
};

export function RiderBadge({ badge, size = 'sm' }) {
    const b = BADGES[badge] || BADGES.bronze;
    const big = size === 'lg';
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: big ? 12 : 8, paddingVertical: big ? 5 : 2, borderRadius: 99, backgroundColor: alpha(b.color, 0.15) }}>
            <Text style={{ fontSize: big ? 16 : 12 }}>{b.icon}</Text>
            <Text style={{ color: b.color, fontWeight: '900', fontSize: big ? 14 : 11.5, marginLeft: 4 }}>{tr(b.label)}</Text>
        </View>
    );
}

export function RiderStanding({ standing }) {
    if (!standing) return null;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
            <RiderBadge badge={standing.badge} />
            {standing.rated > 0 ? <Text style={{ marginLeft: 8, fontSize: 12, fontWeight: '800', color: '#D99A00' }}>★ {Number(standing.rating).toFixed(1)}</Text> : null}
            {standing.deliveries > 0 ? <Text style={{ marginLeft: 8, fontSize: 12, fontWeight: '600', color: '#8A8F98' }}>{tr('{n} deliveries', { n: standing.deliveries })}</Text> : null}
        </View>
    );
}
