// A bar at the top of every superadmin screen: maintenance is ON now, or a planned one is coming. It cannot be dismissed, takes its own space
// (nothing is covered) and tells the screens under it the status bar height is 0 (no double gap). The superadmin app itself is never greyed.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/useAuthStore';
import { fetchPlatform } from '../api/platformApi';
import { fetchMaintenancePlans } from '../api/exportApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ok = (v) => v && !Number.isNaN(new Date(v).getTime());
const fmt = (v) => { const d = new Date(v); const h = d.getHours(); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const clock = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function useMaintenanceNow() {
    const token = useAuthStore((st) => st.token);
    const [m, setM] = useState(null);
    const ask = useCallback(async () => {
        try {
            const p = await fetchPlatform();
            const pm = p?.maintenance;
            if (pm?.on && (!pm.until || new Date(pm.until) > new Date())) { setM({ phase: 'on', message: pm.message, until: pm.until }); return; }
            const plans = await fetchMaintenancePlans();
            const next = (plans?.items || []).filter((x) => x.status === 'planned' && ok(x.startAt)).sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
            setM(next ? { phase: 'upcoming', message: next.message, startAt: next.startAt, until: next.endAt } : null);
        } catch (e) { /* keep what is shown */ }
    }, []);
    useEffect(() => {
        if (!token) { setM(null); return undefined; }
        ask();
        const t = setInterval(ask, 60000);
        return () => clearInterval(t);
    }, [token, ask]);
    return m;
}

export default function MaintenanceFrame({ children, background }) {
    const m = useMaintenanceNow();
    const insets = useSafeAreaInsets();
    const [, tick] = useState(0);
    useEffect(() => { if (!m) return undefined; const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, [m]);

    let bar = null;
    if (m) {
        const on = m.phase === 'on';
        let line;
        if (on) line = [m.message, ok(m.until) ? `Back by ${fmt(m.until)}` : 'Until further notice'].filter(Boolean).join(' · ');
        else {
            const ms = new Date(m.startAt).getTime() - Date.now();
            line = [m.message, fmt(m.startAt) + (ok(m.until) ? ` to ${clock(m.until)}` : ''), ms > 0 && ms < 3 * 3600000 ? `Starts in ${Math.max(1, Math.round(ms / 60000))} min` : ''].filter(Boolean).join(' · ');
        }
        bar = (
            <View style={[s.bar, { paddingTop: insets.top + 6, backgroundColor: on ? '#B3261E' : '#8A5A00' }]}>
                <Text style={s.head}>{on ? '🛠 Maintenance mode is ON for the shops' : '⏰ Maintenance planned'}</Text>
                <Text style={s.txt} numberOfLines={3}>{line}</Text>
            </View>
        );
    }
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            {bar}
            <View style={{ flex: 1 }}>
                <SafeAreaInsetsContext.Provider value={m ? { ...insets, top: 0 } : insets}>{children}</SafeAreaInsetsContext.Provider>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    bar: { paddingHorizontal: 16, paddingBottom: 8 },
    head: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
    txt: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 2 },
});
