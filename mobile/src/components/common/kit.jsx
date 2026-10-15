// src/components/ui/kit.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { View, Text, Pressable, StyleSheet, Appearance, AppState, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';

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

// The looks. "bold" is the original (the shop's own background and text colours); the others set the surfaces
// and let the brand colour be an accent. Cards sit on the canvas, so `surface` is a step away from `background`.
const LOOKS = {
    fresh: { background: '#F6F6F8', surface: '#FFFFFF', text: '#1B1B1F' },
    cream: { background: '#FBF5EA', surface: '#FFFDF8', text: '#2A2118' },
};

// Midnight is not a fixed grey: it is the shop's OWN colour taken down to a deep tone, so a red shop gets a deep wine-black,
// a green shop a deep forest-black, and the brand colour on top of it always belongs. Cards are one clear step lighter
// (shadows do not show on dark), and the text is a warm white, never pure white.
const midnightFrom = (hue) => {
    const h = /^#[0-9a-fA-F]{6}$/.test(hue || '') ? hue : '#E23744';
    return { background: mix('#101013', h, 0.07), surface: mix('#1C1C21', h, 0.1), text: '#F6F2F2' };
};
const lookColors = (theme) => (theme?.look === 'midnight' ? midnightFrom(theme?.colors?.primary) : LOOKS[theme?.look]);
const DEFAULT_ACCENT = '#F59E0B';

// ---- a theme change: the screen stays exactly where it is and its colours MORPH into the new look ----
// Every colour the app draws comes from useBrand(). For about a third of a second after a change, useBrand returns
// the colours part-way between the old look and the new one, so backgrounds, cards, text and brand colours all glide
// together. Nothing fades to black or white, and nothing moves.
const useBlend = create(() => ({ from: null, t: 1 }));
let blendTimer = null;

const BLEND_MS = 240;
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2);   // ease in and out

// run `apply` (which switches the theme) and glide the colours from what is on screen now to the new ones
export function smoothTheme(apply) {
    const st = useThemeStore.getState();
    if (st.theme.motion === 'off') { apply(); return; }
    const cur = useSchemeStore.getState().scheme;
    const from = computeBrand({ ...st.theme, look: resolveLook(st.theme.look, st.appearance, cur) });
    cancelAnimationFrame(blendTimer);
    useBlend.setState({ from, t: 0 });
    apply();
    const start = Date.now();
    const step = () => {
        const p = Math.min(1, (Date.now() - start) / BLEND_MS);
        if (p >= 1) {
            useBlend.setState({ from: null, t: 1 });
            return;
        }
        useBlend.setState({ t: ease(p) });
        blendTimer = requestAnimationFrame(step);   // next frame, as soon as this one has been drawn
    };
    blendTimer = requestAnimationFrame(step);
}

// #RRGGBB or #RRGGBBAA (the soft tints carry an alpha), blended channel by channel
const HEXA = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const blendHex = (a, b, t) => {
    const ch = (c) => [1, 3, 5, 7].map((i) => (i < c.length ? parseInt(c.slice(i, i + 2), 16) : 255));
    const A = ch(a);
    const B = ch(b);
    const plain = a.length === 7 && b.length === 7;   // no alpha on either side: keep it a 6-digit colour
    const out = A.slice(0, plain ? 3 : 4).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
    return '#' + out;
};

// every colour in two token sets, blended by t (non-colour values switch at the half way point)
function blendTokens(from, to, t) {
    const out = {};
    Object.keys(to).forEach((key) => {
        const x = from[key];
        const y = to[key];
        if (typeof y === 'string' && HEXA.test(y) && HEXA.test(x)) out[key] = blendHex(x, y, t);
        else out[key] = t < 0.5 && x !== undefined ? x : y;
    });
    out.dark = to.dark;   // the target decides light/dark things (status bar icons) right away
    out.look = to.look;
    return out;
}

// The phone's light/dark setting, kept live. There is ONE value for the whole app (a store), with one listener, so
// every screen switches in the same moment, behind the veil.
// The built-in useColorScheme can miss a change made while the app was in the background, so it is also re-read
// every time the app comes back to the foreground.
const useSchemeStore = create(() => ({ scheme: Appearance.getColorScheme() }));
let schemeWired = false;
function wireScheme() {
    if (schemeWired) return;
    schemeWired = true;
    const change = (next) => {
        if (!next) return;
        const cur = useSchemeStore.getState().scheme;
        if (next === cur) return;
        const st = useThemeStore.getState();
        const apply = () => useSchemeStore.setState({ scheme: next });
        // only a change that alters the look is blended (a shop that stays the same in both modes needs nothing)
        if (resolveLook(st.theme.look, st.appearance, next) === resolveLook(st.theme.look, st.appearance, cur)) apply();
        else smoothTheme(apply);
    };
    Appearance.addChangeListener(({ colorScheme }) => change(colorScheme || Appearance.getColorScheme()));
    AppState.addEventListener('change', (state) => {
        if (state === 'active') { change(Appearance.getColorScheme()); setTimeout(() => change(Appearance.getColorScheme()), 250); }
    });
}
export function useSystemScheme() {
    wireScheme();
    return useSchemeStore((st) => st.scheme);
}

// Which look is drawn. The customer's Account → Appearance choice decides light or dark:
//   dark   -> midnight
//   light  -> the shop's look, or 'fresh' when the shop's own look is the dark one
//   system -> follows the phone: midnight in dark mode, the light look in light mode
// (a shop whose own look is midnight is therefore light on a light phone, in System mode)
export function resolveLook(shopLook, appearance, scheme) {
    const base = shopLook || 'bold';
    const light = base === 'midnight' ? 'fresh' : base;
    if (appearance === 'dark') return 'midnight';
    if (appearance === 'light') return light;
    return scheme === 'dark' ? 'midnight' : light;
}

// A soft pool of the brand colour inside a card, so a dark card is not a flat grey slab.
// Put it as the FIRST child of the card; it fills the card, ignores touches, and draws nothing in the light looks.
//   from: 'br' (glow in the bottom-right corner, behind the price and the ADD button) or 'tl' (top-left)
export function CardGlow({ radius = 18, from = 'br', strength: base = 0.2 }) {
    const { primary, dark, look } = useBrand();
    const prev = useBlend((st) => st.from);
    const t = useBlend((st) => st.t);
    const glows = (d, l) => (l !== 'bold' && d ? 1 : 0);
    // part-way through a theme change the glow is a mix of "had one" and "has one"
    const amount = prev && t < 1 ? glows(prev.dark, prev.look) * (1 - t) + glows(dark, look) * t : glows(dark, look);
    if (amount <= 0.01 || !isHex(primary)) return null;
    const strength = base * amount;
    const br = from === 'br';
    return (
        <LinearGradient
            pointerEvents="none"
            colors={br ? [alpha(primary, 0), alpha(primary, strength)] : [alpha(primary, strength), alpha(primary, 0)]}
            start={br ? { x: 0.15, y: 0.1 } : { x: 0, y: 0 }}
            end={br ? { x: 1, y: 1 } : { x: 0.85, y: 0.9 }}
            style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
    );
}

// Brand values every screen needs. Everything is derived from the shop's theme.
export function useBrand() {
    const shopTheme = useThemeStore((s) => s.theme);
    const appearance = useThemeStore((s) => s.appearance);
    const scheme = useSystemScheme();
    const lookId = resolveLook(shopTheme.look, appearance, scheme);
    const target = useMemo(
        () => computeBrand(lookId === shopTheme.look ? shopTheme : { ...shopTheme, look: lookId }),
        [shopTheme, lookId],
    );
    const from = useBlend((st) => st.from);
    const t = useBlend((st) => st.t);
    return useMemo(() => (from && t < 1 ? blendTokens(from, target, t) : target), [target, from, t]);
}

// the colours of one theme (theme.look already says which look to draw)
export function computeBrand(theme) {
    {
        const c = theme.colors || {};
        const L = lookColors(theme);
        const background = L ? L.background : (c.background || '#FFFFFF');
        const text = L ? L.text : (c.text || '#1C1C1C');
        const dark = isHex(background) && lum(background) < 0.3;
        // On dark the brand colour is used as it is. Only a brand colour that is itself too dark to see (a deep brown or
        // navy) is brightened, just enough to read. A normal red or green is never washed out.
        const lift = (x) => (L && dark && isHex(x) && lum(x) < 0.12 ? mix(x, '#FFFFFF', 0.3) : x);
        const primary = lift(c.primary || '#E23744');
        const surface = L ? L.surface : dark ? mix(background, '#FFFFFF', 0.07)
            : (isHex(background) && lum(background) > 0.9 ? '#FFFFFF' : mix(background, '#FFFFFF', 0.6));
        const accent = isHex(c.accent) ? c.accent : DEFAULT_ACCENT;
        return {
            primary,
            primaryLight: lift(c.primaryLight) || mix(primary, '#FFFFFF', 0.12),
            primaryDark: lift(c.primaryDark) || mix(primary, '#000000', 0.15),
            onPrimary: onColor(primary),
            accent,
            onAccent: onColor(accent),
            text,
            background,
            error: c.error || '#C62828',
            radius: RADIUS[theme.buttonShape] ?? 12,
            dark,
            surface,
            border: dark ? mix(surface, '#FFFFFF', 0.11) : mix(background, text, 0.12),
            muted: mix(background, text, dark ? 0.62 : 0.55),
            soft: mix(background, primary, dark ? 0.18 : 0.1),
            // the brand glow at the top of the home screen (stronger on dark, where a faint tint disappears)
            wash: mix(background, primary, dark ? 0.42 : 0.16),
            surfaceHigh: dark ? mix(surface, '#FFFFFF', 0.06) : surface,
            look: theme.look || 'bold',
            // meaning colours that stay readable on a dark canvas (pale pastels and mid greens only work on light ones)
            ok: dark ? '#4ADE80' : '#1E8E3E',
            okSoft: dark ? alpha('#4ADE80', 0.16) : '#E6F4EA',
            errorText: dark ? '#FF8A80' : '#B3261E',
            errorSoft: dark ? alpha('#FF6B6B', 0.16) : '#FDECEA',
            neutralSoft: dark ? mix(surface, '#FFFFFF', 0.1) : '#EEEEEE',
        };
    }
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