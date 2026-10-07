// src/ui/status.jsx
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { useAppStatus } from '../../store/useAppStatus';
import { useAuthStore } from '../../store/useAuthStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useHomeStore } from '../../store/useHomeStore';
import { useMenuStore } from '../../store/shopStores';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v) => {
    const d = new Date(v);
    const h = d.getHours();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// any call that works clears the frozen / offline state (see client.js)
const reloadShop = () => Promise.allSettled([useHomeStore.getState().load(), useMenuStore.getState().load()]);

export function FrozenOverlay({ onOrders }) {
    const frozen = useAppStatus((st) => st.frozen);
    const user = useAuthStore((st) => st.user);
    const shop = useThemeStore((st) => st.theme.name);
    const { primary, radius, text, background } = useBrand();
    const insets = useSafeAreaInsets();
    const [busy, setBusy] = useState(false);
    if (!frozen) return null;

    const maint = frozen.status === 503 || frozen.maintenance;
    const msg = frozen.message
        || (maint ? 'We are down for maintenance. Please try again soon.' : 'This shop is not accepting orders right now');
    const until = frozen.until && !Number.isNaN(new Date(frozen.until).getTime()) ? fmt(frozen.until) : '';

    const retry = async () => {
        setBusy(true);
        try { await reloadShop(); } finally { setBusy(false); }
    };

    return (
        <View style={[s.full, { backgroundColor: background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Text style={s.shop}>{shop}</Text>
            <View style={s.body}>
                <Text style={s.emoji}>{maint ? '🛠' : '⛔'}</Text>
                <Text style={[s.title, { color: text }]}>{maint ? 'Back soon' : 'Not available right now'}</Text>
                <Text style={s.msg}>{msg}</Text>
                {maint && until ? <Text style={s.until}>Expected back by {until}</Text> : null}

                <Pressable onPress={retry} disabled={busy} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.solidTxt}>Try again</Text>}
                </Pressable>
                {user ? (
                    <Pressable onPress={onOrders} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                        <Text style={[s.ghostTxt, { color: primary }]}>My orders</Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

export function OfflineBanner() {
    const offline = useAppStatus((st) => st.offline);
    const insets = useSafeAreaInsets();

    // keep trying quietly; the banner hides by itself when a call works
    useEffect(() => {
        if (!offline) return undefined;
        const t = setInterval(reloadShop, 15000);
        return () => clearInterval(t);
    }, [offline]);

    if (!offline) return null;
    return (
        <View style={[s.off, { paddingTop: insets.top + 4 }]}>
            <Text style={s.offTxt}>You are offline. Showing saved data.</Text>
            <Pressable onPress={reloadShop} hitSlop={8}><Text style={s.offBtn}>Retry</Text></Pressable>
        </View>
    );
}

const s = StyleSheet.create({
    full: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
    shop: { textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#777777', paddingTop: 16 },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    emoji: { fontSize: 56 },
    title: { fontSize: 22, fontWeight: '800', marginTop: 14 },
    msg: { fontSize: 14, color: '#666666', textAlign: 'center', marginTop: 8, lineHeight: 20 },
    until: { fontSize: 12, color: '#777777', marginTop: 10 },
    solid: { alignSelf: 'stretch', marginTop: 28, paddingVertical: 14, alignItems: 'center' },
    solidTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    ghost: { alignSelf: 'stretch', marginTop: 12, borderWidth: 1, paddingVertical: 13, alignItems: 'center' },
    ghostTxt: { fontSize: 15, fontWeight: '800' },
    off: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60, elevation: 60, backgroundColor: '#1C1C1C', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 7 },
    offTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    offBtn: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
});