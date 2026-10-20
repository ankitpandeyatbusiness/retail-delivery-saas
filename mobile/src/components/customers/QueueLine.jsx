// Where the guest's order is in the kitchen: "2 orders ahead of yours · ready in about 15 min", or "Being cooked right now". The server says it
// (order.queue) only when the shop shows it; with no queue information nothing is drawn. The time is a guess, so it says "about" and moves in fives.
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { tr } from '../../i18n';

// 4 -> 4, 12 -> 15: a time under ten minutes is exact, a longer one moves in fives
const about = (n) => (n <= 10 ? n : Math.ceil(n / 5) * 5);

// the two short sentences: [where it is, how long], either may be ''
export function queueParts(q) {
    if (!q || (q.stage !== 'waiting' && q.stage !== 'cooking')) return ['', ''];
    const where = q.stage === 'cooking' ? tr('Being cooked right now')
        : q.ahead === 0 ? tr("You're next in the kitchen")
            : q.ahead === 1 ? tr('1 order ahead of yours')
                : tr('{n} orders ahead of yours', { n: q.ahead });
    const when = q.etaMin ? tr('Ready in about {n} min', { n: about(q.etaMin) }) : '';
    return [where, when];
}

export const queueText = (q) => queueParts(q).filter(Boolean).join(' · ');

export default function QueueLine({ q, compact, style }) {
    const { surface, border, text, muted, primary } = useBrand();
    const [where, when] = queueParts(q);
    if (!where) return null;
    const cooking = q.stage === 'cooking';
    if (compact) {
        return (
            <View style={[{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }, style]}>
                <Ionicons name={cooking ? 'flame' : 'hourglass-outline'} size={14} color={primary} style={{ marginRight: 5 }} />
                <Text style={{ color: primary, fontWeight: '800', fontSize: 13, flexShrink: 1 }}>{where}{when ? ` · ${when}` : ''}</Text>
            </View>
        );
    }
    return (
        <View style={[{ marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: surface, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center' }, style]}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Ionicons name={cooking ? 'flame' : 'hourglass-outline'} size={24} color={primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{where}</Text>
                {when ? <Text style={{ color: muted, fontWeight: '700', fontSize: 13.5, marginTop: 2 }}>{when}</Text> : null}
            </View>
        </View>
    );
}
