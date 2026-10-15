import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, section as sec, spacing, radius, font, TAP, tint } from '../theme';
import Icon from './Icon';

const GRAD = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

/* A white block that groups related rows. Never nest cards inside cards. */
export function Card({ children, style, onPress, padded = true }) {
    const t = useTheme();
    const base = [s.card, { backgroundColor: t.surface }, t.shadow, padded && { padding: spacing.lg }, style];
    if (!onPress) return <View style={base}>{children}</View>;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}>
            {children}
        </Pressable>
    );
}

/* A rounded square with a coloured gradient and a white icon: the visual anchor of a row or tile. */
export function IconTile({ icon, section = 'shops', size = 44, danger }) {
    const t = useTheme();
    const g = danger ? sec(t, 'alerts').gradient : sec(t, section).gradient;
    return (
        <View style={{ width: size, height: size, borderRadius: size * 0.32, overflow: 'hidden', backgroundColor: g[0] }}>
            <LinearGradient colors={g} {...GRAD} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={size * 0.55} color="#FFFFFF" />
            </LinearGradient>
        </View>
    );
}

export function Button({ title, onPress, kind = 'primary', loading, disabled, icon, style, small }) {
    const t = useTheme();
    const off = disabled || loading;
    const height = small ? 42 : 52;
    const content = (fg) => (loading ? <ActivityIndicator color={fg} /> : (
        <>
            {icon ? <Icon name={icon} size={20} color={fg} style={{ marginRight: 8 }} /> : null}
            <Text style={{ color: fg, fontSize: font.md, fontWeight: '700' }}>{title}</Text>
        </>
    ));

    if (kind === 'primary') {
        return (
            <Pressable onPress={off ? undefined : onPress} style={({ pressed }) => [{ opacity: off ? 0.5 : pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}>
                {/* no shadow while faded: Android draws the elevation as a hard rectangle behind a translucent button */}
                <View style={[{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: t.gradient[0] }, !off && t.shadow]}>
                    <LinearGradient colors={t.gradient} {...GRAD} style={[s.btn, { height }]}>{content('#FFFFFF')}</LinearGradient>
                </View>
            </Pressable>
        );
    }
    const map = {
        soft: { bg: t.primarySoft, fg: t.primary, border: 'transparent' },
        outline: { bg: 'transparent', fg: t.text, border: t.border },
        danger: { bg: t.danger, fg: '#FFFFFF', border: t.danger },
        dangerSoft: { bg: t.dangerSoft, fg: t.danger, border: 'transparent' },
    }[kind];
    return (
        <Pressable
            onPress={off ? undefined : onPress}
            android_ripple={{ color: tint(map.fg, 0.16) }}
            style={({ pressed }) => [s.btn, { height, backgroundColor: map.bg, borderColor: map.border, borderWidth: 1, overflow: 'hidden', opacity: off ? 0.5 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
        >
            {content(map.fg)}
        </Pressable>
    );
}

/* tone: neutral | success | warn | danger | info | primary */
export function Badge({ label, tone = 'neutral', icon }) {
    const t = useTheme();
    const c = {
        neutral: [t.surfaceAlt, t.muted], success: [t.successSoft, t.success], warn: [t.warnSoft, t.warn],
        danger: [t.dangerSoft, t.danger], info: [t.infoSoft, t.info], primary: [t.primarySoft, t.primary],
    }[tone];
    return (
        <View style={[s.badge, { backgroundColor: c[0] }]}>
            {icon ? <Icon name={icon} size={13} color={c[1]} style={{ marginRight: 4 }} /> : <View style={[s.dot, { backgroundColor: c[1] }]} />}
            <Text style={{ color: c[1], fontSize: font.xs, fontWeight: '700' }}>{label}</Text>
        </View>
    );
}

export function Chip({ label, active, onPress, icon }) {
    const t = useTheme();
    return (
        <Pressable
            onPress={onPress}
            android_ripple={{ color: tint(t.primary, 0.18) }}
            style={({ pressed }) => [s.chip, { overflow: 'hidden', transform: [{ scale: pressed ? 0.96 : 1 }] }, active ? { backgroundColor: t.primary, borderColor: t.primary } : { backgroundColor: t.surface, borderColor: t.border }]}
        >
            {icon ? <Icon name={icon} size={15} color={active ? '#FFFFFF' : t.muted} style={{ marginRight: 6 }} /> : null}
            <Text style={{ color: active ? '#FFFFFF' : t.text, fontSize: font.sm, fontWeight: '700' }}>{label}</Text>
        </Pressable>
    );
}

/*
 * One number with a label. Two in a row.
 *   section="orders"  -> a solid colour tile (white text): use it for the numbers that matter most
 *   no section        -> a white card with a coloured icon chip
 */
export function Stat({ label, value, tone, icon, section, onPress }) {
    const t = useTheme();
    if (section) {
        const g = sec(t, section).gradient;
        const body = (
            <View style={[s.statWrap, { backgroundColor: g[0] }, t.shadow]}>
                <LinearGradient colors={g} {...GRAD} style={s.statFill}>
                    <View style={s.rowBetween}>
                        <Text style={{ flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: font.sm, fontWeight: '600' }} numberOfLines={2}>{label}</Text>
                        {icon ? <View style={{ marginLeft: spacing.sm, flexShrink: 0 }}><Icon name={icon} size={22} color="#FFFFFF" /></View> : null}
                    </View>
                    <Text style={{ color: '#FFFFFF', fontSize: font.xxl, fontWeight: '800', marginTop: spacing.sm }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                </LinearGradient>
            </View>
        );
        return onPress ? <Pressable onPress={onPress} style={{ flex: 1 }}>{body}</Pressable> : <View style={{ flex: 1 }}>{body}</View>;
    }
    const color = { success: t.success, warn: t.warn, danger: t.danger, info: t.info }[tone] || t.text;
    return (
        <Card onPress={onPress} style={{ flex: 1 }}>
            <View style={s.rowBetween}>
                <Text style={{ flex: 1, color: t.muted, fontSize: font.sm, fontWeight: '600' }} numberOfLines={2}>{label}</Text>
                {icon ? <View style={{ marginLeft: spacing.sm, flexShrink: 0 }}><Icon name={icon} size={22} color={color === t.text ? t.primary : color} /></View> : null}
            </View>
            <Text style={{ color, fontSize: font.xxl, fontWeight: '800', marginTop: spacing.xs }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        </Card>
    );
}

/* label on the left, value on the right */
export function KeyValue({ label, value, last }) {
    const t = useTheme();
    return (
        <View style={[s.kv, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }]}>
            <Text style={{ color: t.muted, fontSize: font.md, flex: 1 }}>{label}</Text>
            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '600', flex: 1.4, textAlign: 'right' }} selectable>
                {value ?? '—'}
            </Text>
        </View>
    );
}

/* A tappable line: coloured icon tile, title, optional subtitle, chevron. `section` picks the tile colour. */
export function ListRow({ icon, title, subtitle, right, onPress, last, danger, section = 'shops' }) {
    const t = useTheme();
    return (
        <Pressable
            onPress={onPress}
            android_ripple={onPress ? { color: tint(t.primary, 0.1) } : undefined}
            style={({ pressed }) => [s.listRow, pressed && onPress && { backgroundColor: tint(t.primary, 0.05) }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }]}
        >
            {icon ? <View style={{ marginRight: spacing.md }}><IconTile icon={icon} section={section} danger={danger} size={42} /></View> : null}
            <View style={{ flex: 1 }}>
                <Text style={{ color: danger ? t.danger : t.text, fontSize: font.md, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            {right}
            {onPress ? <Icon name="next" size={18} color={t.muted} style={{ marginLeft: spacing.sm }} /> : null}
        </Pressable>
    );
}

export function Avatar({ name, size = 44, section = 'shops' }) {
    const t = useTheme();
    const g = sec(t, section).gradient;
    const letters = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
    return (
        <LinearGradient colors={g} {...GRAD} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: size * 0.38 }}>{letters}</Text>
        </LinearGradient>
    );
}

export function SectionTitle({ children, right, section = 'shops' }) {
    const t = useTheme();
    const c = sec(t, section).color;
    return (
        <View style={[s.rowBetween, { marginTop: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: 2 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: c, marginRight: 8 }} />
                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>{children}</Text>
            </View>
            {right}
        </View>
    );
}

const s = StyleSheet.create({
    card: { borderRadius: radius.lg },
    btn: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: spacing.lg },
    badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, alignSelf: 'flex-start' },
    dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
    chip: { flexDirection: 'row', paddingHorizontal: 16, height: 38, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    statWrap: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
    statFill: { padding: spacing.lg, minHeight: 92 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kv: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, gap: spacing.md },
    listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: spacing.md },
});
