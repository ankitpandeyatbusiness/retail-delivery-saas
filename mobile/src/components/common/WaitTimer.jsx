// A live "how long has he waited" clock. Counts up from `since` every second; goes amber after 10 minutes and red after 20.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tr } from '../../i18n';

export function useTick(on = true, ms = 1000) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!on) return undefined;
        const t = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(t);
    }, [on, ms]);
    return now;
}
// 7:05, or 1:02:09 after an hour
export const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
export const waitColor = (ms, b) => (ms >= 20 * 60000 ? b.error : ms >= 10 * 60000 ? b.warn : b.ok);

export default function WaitTimer({ since, compact, style }) {
    const b = useBrand();
    const now = useTick(!!since);
    if (!since) return null;
    const ms = now - new Date(since).getTime();
    const color = waitColor(ms, b);
    return (
        <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
            <Ionicons name="hourglass" size={compact ? 11 : 14} color={color} />
            <Text style={{ color, fontWeight: '900', fontSize: compact ? 11 : 13, marginLeft: 4 }}>{compact ? '' : `${tr('Waiting')} `}{clock(ms)}</Text>
        </View>
    );
}

// what a finished round shows: how long it took
export function ServedIn({ times, style }) {
    const { ok } = useBrand();
    if (!times?.served || !times?.placed) return null;
    const m = Math.max(1, Math.round((new Date(times.served) - new Date(times.placed)) / 60000));
    return <Text style={[{ color: ok, fontWeight: '800', fontSize: 12.5 }, style]}>{tr('Served in {m} min', { m })}</Text>;
}
