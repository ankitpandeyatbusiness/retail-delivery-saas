// The small building blocks of the rider's screens. Big, plain and few: a rider uses these with one hand, outdoors.
import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { ActivityIndicator } from '../common/Loading';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';

const AMBER = '#F59E0B';

// the one big button of a screen
export function BigButton({ label, onPress, kind = 'primary', icon, busy, disabled, style, iconOnly }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    const fill = kind === 'primary' ? primary : kind === 'danger' ? error : 'transparent';
    const ink = kind === 'primary' ? onPrimary : kind === 'danger' ? '#FFFFFF' : text;
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || busy}
            accessibilityRole="button" accessibilityLabel={iconOnly ? label : undefined}
            style={({ pressed }) => [
                s.big, { backgroundColor: fill, borderColor: kind === 'outline' ? border : fill, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style,
            ]}
        >
            {busy ? <ActivityIndicator color={ink} /> : (
                <>
                    {icon ? <Ionicons name={icon} size={iconOnly ? 26 : 22} color={ink} style={{ marginRight: iconOnly ? 0 : 10 }} /> : null}
                    {iconOnly && icon ? null : <Text style={[s.bigText, { color: ink }]} numberOfLines={1}>{label}</Text>}
                    {/* an invisible twin of the icon on the right, so the words sit exactly in the middle of the button */}
                    {icon && !iconOnly ? <Ionicons name={icon} size={22} color={ink} style={{ marginLeft: 10, opacity: 0 }} /> : null}
                </>
            )}
        </Pressable>
    );
}

// a quiet text button under the main one
export function SmallLink({ label, onPress, danger, icon, iconOnly }) {
    const { muted, error } = useBrand();
    return (
        <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={iconOnly ? label : undefined} style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}>
            {icon ? <Ionicons name={icon} size={iconOnly ? 22 : 16} color={danger ? error : muted} style={{ marginRight: iconOnly ? 0 : 6 }} /> : null}
            {iconOnly && icon ? null : <Text numberOfLines={1} style={{ color: danger ? error : muted, fontWeight: '800', fontSize: 14 }}>{label}</Text>}
        </Pressable>
    );
}

// one line that cannot be missed: cash to collect (amber), already paid (green), or a warning (red)
export function Banner({ tone = 'warn', icon, text, style }) {
    const { ok, error } = useBrand();
    const color = tone === 'ok' ? ok : tone === 'bad' ? error : AMBER;
    return (
        <View style={[s.banner, { backgroundColor: alpha(color, 0.16), borderColor: alpha(color, 0.5) }, style]}>
            <Ionicons name={icon || (tone === 'ok' ? 'checkmark-circle' : tone === 'bad' ? 'alert-circle' : 'cash')} size={22} color={color} />
            <Text style={{ flex: 1, color, fontWeight: '900', fontSize: 16, marginLeft: 10 }}>{text}</Text>
        </View>
    );
}

// where he is in the delivery: Collect, On the way, Deliver
export function Steps({ labels, step }) {
    const { primary, border, muted, text } = useBrand();
    return (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 8 }}>
            {labels.map((l, i) => (
                <View key={l} style={{ flex: 1 }}>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: i <= step ? primary : border }} />
                    <Text style={{ color: i === step ? text : muted, fontSize: 12, fontWeight: i === step ? '900' : '600', marginTop: 5 }}>{l}</Text>
                </View>
            ))}
        </View>
    );
}

export function Avatar({ uri, size = 46, onPress, busy }) {
    const { border, surface, muted, primary, onPrimary } = useBrand();
    const body = (
        <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivityIndicator color={primary} /> : uri
                ? <Image source={{ uri }} style={{ width: size - 2, height: size - 2, borderRadius: (size - 2) / 2 }} />
                : <Ionicons name="person" size={size * 0.5} color={muted} />}
            {onPress ? <View style={[s.badge, { backgroundColor: primary }]}><Ionicons name="camera" size={11} color={onPrimary} /></View> : null}
        </View>
    );
    return onPress ? <Pressable onPress={onPress} hitSlop={6}>{body}</Pressable> : body;
}

const s = StyleSheet.create({
    big: { minHeight: 60, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
    bigText: { fontSize: 17, fontWeight: '900' },
    link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    banner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 12 },
    badge: { position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
