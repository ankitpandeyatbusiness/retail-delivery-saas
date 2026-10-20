// "The shop is full right now": shown to a customer who is about to order at a table, so a long wait is no surprise.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { fetchDineStatus } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

export default function DineBusyNote({ plain, color, style }) {
    const { accent, text } = useBrand();
    const [st, setSt] = useState(null);
    useEffect(() => {
        let alive = true;
        const load = () => fetchDineStatus().then((r) => { if (alive) setSt(r); }).catch(() => {});
        load();
        const t = setInterval(load, 60000);
        return () => { alive = false; clearInterval(t); };
    }, []);
    if (!st?.busy) return null;
    const warn = accent || '#F59E0B';
    const msg = st.extraMin ? tr('We are very busy right now. Your food may take about {n} min longer.', { n: st.extraMin }) : tr('We are very busy right now. Your food may take longer.');
    if (plain) {
        return (
            <View style={[{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }, style]}>
                <Ionicons name="time" size={15} color={color || text} />
                <Text style={{ color: color || text, fontSize: 12.5, fontWeight: '700', marginLeft: 6, flex: 1 }}>{msg}</Text>
            </View>
        );
    }
    return (
        <View style={[{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: alpha(warn, 0.14), borderWidth: 1, borderColor: alpha(warn, 0.5), marginTop: 12 }, style]}>
            <Ionicons name="time" size={20} color={warn} />
            <Text style={{ color: text, fontSize: 13, fontWeight: '700', marginLeft: 10, flex: 1 }}>{msg}</Text>
        </View>
    );
}
