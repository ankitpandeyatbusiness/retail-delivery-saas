import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Switch, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import Icon from './Icon';
import { useTheme, spacing, radius, font, TAP } from '../theme';

export function Field({ label, hint, error, style, multiline, ...props }) {
    const t = useTheme();
    return (
        <View style={[{ marginBottom: spacing.lg }, style]}>
            {label ? <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '600', marginBottom: 6 }}>{label}</Text> : null}
            <TextInput
                placeholderTextColor={t.muted}
                multiline={multiline}
                style={{
                    minHeight: multiline ? 96 : TAP, borderRadius: radius.md, borderWidth: 1,
                    borderColor: error ? t.danger : t.border, backgroundColor: t.surface, color: t.text,
                    paddingHorizontal: spacing.lg, paddingVertical: multiline ? spacing.md : 0,
                    textAlignVertical: multiline ? 'top' : 'center', fontSize: font.md,
                }}
                {...props}
            />
            {error ? <Text style={{ color: t.danger, fontSize: font.xs, marginTop: 4 }}>{error}</Text> : null}
            {!error && hint ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 4 }}>{hint}</Text> : null}
        </View>
    );
}

export function SearchBar({ value, onChangeText, placeholder = 'Search', onSubmit }) {
    const t = useTheme();
    return (
        <View style={[s.search, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Icon name="search" size={20} color={t.primary} />
            <TextInput
                value={value}
                onChangeText={onChangeText}
                onSubmitEditing={onSubmit}
                placeholder={placeholder}
                placeholderTextColor={t.muted}
                returnKeyType="search"
                numberOfLines={1}
                multiline={false}
                textAlignVertical="center"
                autoCapitalize="none"
                style={{ flex: 1, color: t.text, fontSize: font.md, marginLeft: spacing.sm, paddingVertical: 0 }}
            />
            {value ? (
                <Pressable onPress={() => onChangeText('')} hitSlop={10}>
                    <Icon name="clear" size={20} color={t.muted} />
                </Pressable>
            ) : null}
        </View>
    );
}

export function ToggleRow({ title, subtitle, value, onValueChange, disabled, last }) {
    const t = useTheme();
    return (
        <View style={[s.toggle, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }]}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '600' }}>{title}</Text>
                {subtitle ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
            <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: t.primary, false: t.border }} />
        </View>
    );
}

/* a short row of choices: exactly one is selected */
// A row of choices with a highlight that SLIDES to the chosen one (the same look and motion as the customer app's Appearance switch).
// The choice shows at once; onChange is called at once too. A caller that repaints the whole app (the theme) waits for the slide itself.
export function Segmented({ options, value, onChange }) {
    const t = useTheme();
    const [w, setW] = useState(0);
    const [sel, setSel] = useState(value);
    const idx = Math.max(0, options.findIndex((o) => o.value === sel));
    const slide = useRef(new Animated.Value(idx)).current;
    useEffect(() => { setSel(value); }, [value]);
    useEffect(() => { Animated.timing(slide, { toValue: idx, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [idx, slide]);
    const segW = w ? (w - 6) / options.length : 0;
    return (
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[s.seg, { backgroundColor: t.surfaceAlt }]}>
            {segW ? <Animated.View pointerEvents="none" style={[s.segThumb, { width: segW, backgroundColor: t.surface, transform: [{ translateX: Animated.multiply(slide, segW) }] }]} /> : null}
            {options.map((o) => {
                const on = o.value === sel;
                return (
                    <Pressable key={o.value} onPress={() => { if (o.value === sel) return; setSel(o.value); onChange(o.value); }} style={s.segItem} accessibilityRole="button" accessibilityState={{ selected: on }}>
                        <Text style={{ color: on ? t.text : t.muted, fontWeight: on ? '700' : '600', fontSize: font.sm }}>{o.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const s = StyleSheet.create({
    search: { flexDirection: 'row', alignItems: 'center', height: TAP, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md },
    toggle: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: spacing.sm },
    seg: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
    segThumb: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: radius.sm },
    segItem: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
