import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, section as sec, spacing, radius, font, tint } from '../theme';
import Icon from './Icon';
import { Card } from './ui';

const GRAD = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

/* ---------------------------- loading skeletons ---------------------------- */
// grey bars that pulse: shows the SHAPE of what is coming, which feels faster than a spinner
export function SkeletonBar({ width = '100%', height = 14, radiusPx = 8, style }) {
    const t = useTheme();
    const a = useRef(new Animated.Value(0.45)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(a, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [a]);
    return <Animated.View style={[{ width, height, borderRadius: radiusPx, backgroundColor: t.border, opacity: a }, style]} />;
}

// n card-shaped placeholders (a list of shops, users...)
export function SkeletonList({ count = 5, avatar = true }) {
    return (
        <View style={{ padding: spacing.lg }}>
            {Array.from({ length: count }).map((_, i) => (
                <Card key={i} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {avatar ? <SkeletonBar width={44} height={44} radiusPx={22} /> : null}
                        <View style={{ flex: 1, marginLeft: avatar ? spacing.md : 0 }}>
                            <SkeletonBar width="60%" height={15} />
                            <SkeletonBar width="35%" height={12} style={{ marginTop: 8 }} />
                        </View>
                    </View>
                </Card>
            ))}
        </View>
    );
}

// the dashboard while it loads for the first time
export function SkeletonDashboard() {
    return (
        <View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
                <SkeletonBar height={92} radiusPx={radius.lg} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                {[0, 1, 2, 3].map((i) => <SkeletonBar key={i} height={74} radiusPx={radius.lg} style={{ flex: 1 }} />)}
            </View>
            <SkeletonBar height={20} width="40%" style={{ marginTop: spacing.xl }} />
            <SkeletonBar height={150} radiusPx={radius.lg} style={{ marginTop: spacing.md }} />
        </View>
    );
}

/* ---------------------------- quick actions ---------------------------- */
// A row of big round-square buttons: icon on a coloured gradient, label below.
export function QuickActions({ items }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {items.map((it) => {
                const g = sec(t, it.section || 'shops').gradient;
                return (
                    <Pressable key={it.label} onPress={it.onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}>
                        <View>
                            <LinearGradient colors={g} {...GRAD} style={[s.qa, t.shadow]}>
                                <Icon name={it.icon} size={26} color="#FFFFFF" />
                            </LinearGradient>
                            {it.badge ? <View style={s.qaBadge}><Text style={s.qaBadgeText}>{it.badge}</Text></View> : null}
                        </View>
                        <Text style={{ color: t.text, fontSize: font.xs, fontWeight: '700', marginTop: 6, textAlign: 'center' }} numberOfLines={2}>{it.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ---------------------------- stat strip ---------------------------- */
// Three or four small numbers in one card, each with its own colour. items: [{ label, value, section, onPress }]
export function StatStrip({ items }) {
    const t = useTheme();
    return (
        <Card padded={false} style={{ flexDirection: 'row' }}>
            {items.map((it, i) => {
                const c = sec(t, it.section || 'shops');
                const body = (
                    <View style={{ paddingVertical: spacing.md, alignItems: 'center', borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderLeftColor: t.border }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.color, marginBottom: 6 }} />
                        <Text style={{ color: t.text, fontSize: font.xl, fontWeight: '800' }}>{it.value}</Text>
                        <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '600', marginTop: 2, textAlign: 'center' }}>{it.label}</Text>
                    </View>
                );
                return it.onPress
                    ? <Pressable key={it.label} onPress={it.onPress} style={{ flex: 1 }}>{body}</Pressable>
                    : <View key={it.label} style={{ flex: 1 }}>{body}</View>;
            })}
        </Card>
    );
}

/* ---------------------------- hero ---------------------------- */
// A tinted card at the top of a detail screen: leading visual, title, subtitle and free content below.
export function Hero({ leading, title, subtitle, section = 'shops', children, right }) {
    const t = useTheme();
    const c = sec(t, section);
    return (
        <View style={[s.hero, { backgroundColor: t.surface, borderColor: tint(c.color, 0.25) }, t.shadow]}>
            <View style={[s.heroBar, { backgroundColor: c.color }]} />
            <View style={{ padding: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {leading}
                    <View style={{ flex: 1, marginLeft: leading ? spacing.md : 0 }}>
                        <Text style={{ color: t.text, fontSize: font.lg + 1, fontWeight: '800' }} numberOfLines={1}>{title}</Text>
                        {subtitle ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
                    </View>
                    {right}
                </View>
                {children}
            </View>
        </View>
    );
}

/* a ranked row (1, 2, 3 with medal colours) */
export function RankRow({ rank, title, subtitle, value, last, onPress }) {
    const t = useTheme();
    const medal = ['#F5B301', '#9AA3B2', '#C98A4B'][rank - 1] || t.muted;
    return (
        <Pressable onPress={onPress} style={[s.rank, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }]}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: tint(medal, 0.2), alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: medal, fontWeight: '800' }}>{rank}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={{ color: t.muted, fontSize: font.sm }}>{subtitle}</Text> : null}
            </View>
            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{value}</Text>
        </Pressable>
    );
}

const s = StyleSheet.create({
    qa: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    qaBadge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    qaBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    hero: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
    heroBar: { height: 5 },
    rank: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
});
