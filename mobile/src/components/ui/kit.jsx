// src/components/ui/kit.jsx
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';

const RADIUS = { rounded: 12, square: 3, pill: 99 };

/* ---------- colour helpers (safe on bad input: they return the first colour unchanged) ---------- */
const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
const toRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (a) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const mix = (a, b, t) => {
    if (!isHex(a) || !isHex(b)) return a;
    const A = toRgb(a);
    const B = toRgb(b);
    return toHex(A.map((v, i) => v + (B[i] - v) * t));
};
export const alpha = (c, a) => (isHex(c) ? `${c}${Math.round(a * 255).toString(16).padStart(2, '0')}` : c);
const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = toRgb(c);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
// readable text colour on top of any brand colour (logo colours always give white)
export const onColor = (c) => (isHex(c) && lum(c) > 0.6 ? '#1A1A1A' : '#FFFFFF');

// Brand values every screen needs. Everything is derived from the shop's theme.
export function useBrand() {
    const theme = useThemeStore((s) => s.theme);
    return useMemo(() => {
        const c = theme.colors || {};
        const primary = c.primary || '#E23744';
        const background = c.background || '#FFFFFF';
        const text = c.text || '#1C1C1C';
        const dark = isHex(background) && lum(background) < 0.3;
        const surface = dark ? mix(background, '#FFFFFF', 0.07)
            : (isHex(background) && lum(background) > 0.9 ? '#FFFFFF' : mix(background, '#FFFFFF', 0.6));
        return {
            primary,
            primaryLight: c.primaryLight || mix(primary, '#FFFFFF', 0.12),
            primaryDark: c.primaryDark || mix(primary, '#000000', 0.15),
            onPrimary: onColor(primary),
            text,
            background,
            error: c.error || '#C62828',
            radius: RADIUS[theme.buttonShape] ?? 12,
            dark,
            surface,
            border: mix(background, text, 0.12),
            muted: mix(background, text, 0.55),
            soft: mix(background, primary, 0.1),
        };
    }, [theme]);
}

// Top bar with a back arrow on the left (for full-screen pages)
export function BackHeader({ title }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { text, background } = useBrand();
    return (
        <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: background }]}>
            <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={12} style={s.back}>
                <Ionicons name="arrow-back" size={24} color={text} />
            </Pressable>
            <Text style={[s.title, { color: text }]} numberOfLines={1}>{title}</Text>
        </View>
    );
}

// Shown in place of a tab when the visitor is a guest
export function GuestGate({ title, children }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const user = useAuthStore((st) => st.user);
    const { primary, onPrimary, radius, text, background, muted } = useBrand();
    if (user) return children;
    return (
        <View style={[s.center, { paddingTop: insets.top, backgroundColor: background }]}>
            <Text style={[s.gateTitle, { color: text }]}>{title}</Text>
            <Text style={[s.gateText, { color: muted }]}>Log in to see this.</Text>
            <Pressable onPress={() => nav.navigate('Login')} style={[s.btn, { backgroundColor: primary, borderRadius: radius }]}>
                <Text style={[s.btnText, { color: onPrimary }]}>Log in</Text>
            </Pressable>
        </View>
    );
}

// Temporary body for screens built in later batches
export function ComingSoon({ title, back }) {
    const insets = useSafeAreaInsets();
    const { background, text, muted } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            {back ? <BackHeader title={title} /> : null}
            <View style={[s.center, !back && { paddingTop: insets.top }]}>
                <Text style={[s.gateTitle, { color: text }]}>{title}</Text>
                <Text style={[s.gateText, { color: muted }]}>Coming in the next batch</Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
    back: { paddingRight: 14, paddingVertical: 4 },
    title: { flex: 1, fontSize: 18, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    gateTitle: { fontSize: 20, fontWeight: '800' },
    gateText: { marginTop: 6, fontSize: 14 },
    btn: { marginTop: 18, paddingHorizontal: 32, paddingVertical: 12 },
    btnText: { fontSize: 15, fontWeight: '700' },
});