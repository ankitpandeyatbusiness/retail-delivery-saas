// src/ui/kit.jsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';

const RADIUS = { rounded: 12, square: 3, pill: 99 };

// Brand values every screen needs: colours and button radius from the shop's theme
export function useBrand() {
    const theme = useThemeStore((s) => s.theme);
    return {
        primary: theme.colors.primary,
        primaryLight: theme.colors.primaryLight,
        text: theme.colors.text,
        background: theme.colors.background,
        error: theme.colors.error,
        radius: RADIUS[theme.buttonShape] ?? 12,
    };
}

// Top bar with a back arrow on the left (for full-screen pages)
export function BackHeader({ title }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { text } = useBrand();
    return (
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
            <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={12} style={s.back}>
                <Text style={[s.backIcon, { color: text }]}>←</Text>
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
    const { primary, radius, text, background } = useBrand();
    if (user) return children;
    return (
        <View style={[s.center, { paddingTop: insets.top, backgroundColor: background }]}>
            <Text style={[s.gateTitle, { color: text }]}>{title}</Text>
            <Text style={s.gateText}>Log in to see this.</Text>
            <Pressable onPress={() => nav.navigate('Login')} style={[s.btn, { backgroundColor: primary, borderRadius: radius }]}>
                <Text style={s.btnText}>Log in</Text>
            </Pressable>
        </View>
    );
}

// Temporary body for screens built in later batches
export function ComingSoon({ title, back }) {
    const insets = useSafeAreaInsets();
    const { background, text } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            {back ? <BackHeader title={title} /> : null}
            <View style={[s.center, !back && { paddingTop: insets.top }]}>
                <Text style={[s.gateTitle, { color: text }]}>{title}</Text>
                <Text style={s.gateText}>Coming in the next batch</Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#FFFFFF' },
    back: { paddingRight: 14, paddingVertical: 4 },
    backIcon: { fontSize: 24 },
    title: { flex: 1, fontSize: 18, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    gateTitle: { fontSize: 20, fontWeight: '800' },
    gateText: { marginTop: 6, fontSize: 14, color: '#777777' },
    btn: { marginTop: 18, paddingHorizontal: 32, paddingVertical: 12 },
    btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});