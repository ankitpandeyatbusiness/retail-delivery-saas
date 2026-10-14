import React from 'react';
import { View, Text, TextInput, Switch, Pressable, StyleSheet } from 'react-native';
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
                autoCapitalize="none"
                style={{ flex: 1, color: t.text, fontSize: font.md, marginLeft: spacing.sm }}
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
export function Segmented({ options, value, onChange }) {
    const t = useTheme();
    return (
        <View style={[s.seg, { backgroundColor: t.surfaceAlt }]}>
            {options.map((o) => {
                const on = o.value === value;
                return (
                    <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, on && { backgroundColor: t.surface }]}>
                        <Text style={{ color: on ? t.text : t.muted, fontWeight: '600', fontSize: font.sm }}>{o.label}</Text>
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
    segItem: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
