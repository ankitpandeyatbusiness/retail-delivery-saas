import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme, spacing, radius, font, TAP, section as sec } from '../theme';
import { Card, SectionTitle, Chip, Badge } from './ui';
import { ToggleRow } from './inputs';
import Icon from './Icon';
import { isHex } from '../utils/settings';

/* A titled card holding one group of related settings. */
export function Group({ title, hint, section = 'settings', children, flush }) {
    const t = useTheme();
    return (
        <>
            {title ? <SectionTitle section={section}>{title}</SectionTitle> : <View style={{ height: spacing.lg }} />}
            {hint ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: -4, marginBottom: spacing.sm, paddingHorizontal: 2 }}>{hint}</Text> : null}
            <Card style={flush ? { paddingVertical: 0 } : undefined}>{children}</Card>
        </>
    );
}

export function Label({ children, hint }) {
    const t = useTheme();
    return (
        <View style={{ marginBottom: 8 }}>
            <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{children}</Text>
            {hint ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{hint}</Text> : null}
        </View>
    );
}

export function Hint({ children, tone = 'muted' }) {
    const t = useTheme();
    const c = tone === 'warn' ? t.warn : t.muted;
    return <Text style={{ color: c, fontSize: font.xs, marginTop: 6, lineHeight: 17 }}>{children}</Text>;
}

/* pick exactly one */
export function Choice({ label, hint, options, value, onChange, last }) {
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {options.map((o) => (
                    <View key={o.value} style={{ marginBottom: spacing.sm }}>
                        <Chip label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />
                    </View>
                ))}
            </View>
        </View>
    );
}

/* pick several (min / max respected) */
export function MultiChoice({ label, hint, options, value = [], onChange, min = 0, max = 99, last }) {
    const toggle = (v) => {
        const has = value.includes(v);
        if (has && value.length <= min) return;
        if (!has && value.length >= max) return;
        onChange(has ? value.filter((x) => x !== v) : [...value, v]);
    };
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {options.map((o) => (
                    <View key={o.value} style={{ marginBottom: spacing.sm }}>
                        <Chip label={o.label} active={value.includes(o.value)} onPress={() => toggle(o.value)} />
                    </View>
                ))}
            </View>
        </View>
    );
}

export const Switch = ToggleRow;

/*
 * A number box. `value` is a number or undefined; onChange gets a number, or undefined when the box is emptied.
 * Keeps its own text so typing "1." or "" does not fight the parent.
 */
export function NumberField({ label, hint, value, onChange, prefix, suffix, placeholder, integer, style, last }) {
    const t = useTheme();
    const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
    useEffect(() => {
        const cur = text.trim() === '' ? undefined : Number(text);
        if (cur !== value && !(Number.isNaN(cur) && value === undefined)) setText(value === undefined || value === null ? '' : String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    const change = (v) => {
        const clean = integer ? v.replace(/[^\d]/g, '') : v.replace(/[^\d.]/g, '');
        setText(clean);
        if (clean === '') onChange(undefined);
        else if (!Number.isNaN(Number(clean))) onChange(Number(clean));
    };
    return (
        <View style={[{ marginBottom: last ? 0 : spacing.lg }, style]}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <View style={[s.numWrap, { backgroundColor: t.surface, borderColor: t.border }]}>
                {prefix ? <Text style={{ color: t.muted, fontWeight: '700', marginRight: 6 }}>{prefix}</Text> : null}
                <TextInput
                    value={text}
                    onChangeText={change}
                    keyboardType={integer ? 'number-pad' : 'decimal-pad'}
                    placeholder={placeholder}
                    placeholderTextColor={t.muted}
                    style={{ flex: 1, color: t.text, fontSize: font.md, fontWeight: '600' }}
                />
                {suffix ? <Text style={{ color: t.muted, fontWeight: '700', marginLeft: 6 }}>{suffix}</Text> : null}
            </View>
        </View>
    );
}

export function TextField({ label, hint, value, onChange, placeholder, maxLength, multiline, last, autoCapitalize = 'sentences', keyboardType }) {
    const t = useTheme();
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <TextInput
                value={value ?? ''}
                onChangeText={onChange}
                placeholder={placeholder}
                placeholderTextColor={t.muted}
                maxLength={maxLength}
                multiline={multiline}
                autoCapitalize={autoCapitalize}
                keyboardType={keyboardType}
                style={{
                    minHeight: multiline ? 80 : TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface,
                    color: t.text, paddingHorizontal: spacing.md, fontSize: font.md, textAlignVertical: multiline ? 'top' : 'center',
                    paddingVertical: multiline ? spacing.sm : 0,
                }}
            />
        </View>
    );
}

// a quick set of good colours to start from
const SWATCHES = ['#E23744', '#FF6B3D', '#FF9F1C', '#F2B705', '#16A34A', '#0E9F8E', '#2F80ED', '#4F46E5', '#8B3DEB', '#D6336C', '#1C1C1C', '#FFFFFF'];

/* a colour: swatch + #RRGGBB box + quick picks */
export function ColorField({ label, hint, value, onChange, last }) {
    const t = useTheme();
    const [text, setText] = useState(value || '');
    useEffect(() => { setText(value || ''); }, [value]);
    const ok = !text || isHex(text);
    const change = (v) => {
        let x = v.trim();
        if (x && x[0] !== '#') x = `#${x}`;
        x = x.slice(0, 7).toUpperCase();
        setText(x);
        if (isHex(x)) onChange(x);
        else if (x === '' || x === '#') onChange(undefined);
    };
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[s.swatchBig, { backgroundColor: isHex(value) ? value : t.surfaceAlt, borderColor: t.border }]} />
                <TextInput
                    value={text}
                    onChangeText={change}
                    placeholder="#RRGGBB"
                    placeholderTextColor={t.muted}
                    autoCapitalize="characters"
                    maxLength={7}
                    style={{
                        flex: 1, marginLeft: spacing.md, height: 44, borderRadius: radius.md, borderWidth: 1, backgroundColor: t.surface,
                        borderColor: ok ? t.border : t.danger, color: t.text, paddingHorizontal: spacing.md, fontWeight: '700',
                    }}
                />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                {SWATCHES.map((c) => (
                    <Pressable key={c} onPress={() => { setText(c); onChange(c); }} style={[s.swatch, { backgroundColor: c, borderColor: value === c ? t.text : t.border }]} />
                ))}
            </ScrollView>
        </View>
    );
}

/*
 * A list the user can reorder with up / down arrows and switch items on or off.
 * items: [{ key, label, enabled?, locked? }]  ->  onChange(newItems)
 * locked = cannot be switched off (for example "home" tab)
 */
export function ReorderList({ items, onChange, section = 'settings', toggle = true }) {
    const t = useTheme();
    const c = sec(t, section);
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = items.slice();
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    const flip = (i) => onChange(items.map((x, k) => (k === i ? { ...x, enabled: !x.enabled } : x)));
    return (
        <View>
            {items.map((it, i) => {
                const on = it.enabled !== false;
                return (
                    <View key={it.key} style={[s.reRow, { borderColor: t.border, backgroundColor: on ? t.surface : t.surfaceAlt }]}>
                        <Text style={{ width: 22, color: t.muted, fontWeight: '800' }}>{i + 1}</Text>
                        <Text style={{ flex: 1, color: on ? t.text : t.muted, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{it.label}</Text>
                        {toggle && !it.locked ? (
                            <Pressable onPress={() => flip(i)} hitSlop={6} style={[s.pill, { backgroundColor: on ? c.soft : t.border }]}>
                                <Text style={{ color: on ? c.color : t.muted, fontSize: font.xs, fontWeight: '800' }}>{on ? 'ON' : 'OFF'}</Text>
                            </Pressable>
                        ) : it.locked ? <Badge label="Always on" /> : null}
                        <Pressable onPress={() => move(i, -1)} hitSlop={6} style={s.arrow}>
                            <Icon name="next" size={18} color={i === 0 ? t.border : t.text} style={{ transform: [{ rotate: '-90deg' }] }} />
                        </Pressable>
                        <Pressable onPress={() => move(i, 1)} hitSlop={6} style={s.arrow}>
                            <Icon name="next" size={18} color={i === items.length - 1 ? t.border : t.text} style={{ transform: [{ rotate: '90deg' }] }} />
                        </Pressable>
                    </View>
                );
            })}
        </View>
    );
}

const s = StyleSheet.create({
    numWrap: { flexDirection: 'row', alignItems: 'center', height: TAP, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md },
    swatchBig: { width: 44, height: 44, borderRadius: 14, borderWidth: 1 },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, marginRight: spacing.sm },
    reRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
    pill: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    arrow: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
});
