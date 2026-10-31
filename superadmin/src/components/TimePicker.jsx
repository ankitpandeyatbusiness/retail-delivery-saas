// A time of day, set from a digital clock instead of the keyboard (24-hour, 1-minute steps).
//   <TimeField label value="19:30" onChange /> looks like a text box: touch it and the clock sheet opens (the keyboard stays down);
//   the clock icon opens it again, and "Write it myself" in the sheet closes it and lets him type (numbers only, like 19:30).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Keyboard } from 'react-native';
import { useTheme, spacing, radius, font, tint, TAP } from '../theme';
import { Sheet } from './feedback';
import { Button } from './ui';
import { Label } from './settingsForm';
import Icon from './Icon';

const ITEM = 46;
const ROWS = 5;
const pad = (n) => String(n).padStart(2, '0');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const maskTime = (v) => {
    const d = String(v).replace(/[^\d]/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
const parse = (value) => {
    if (TIME_RE.test(value || '')) { const [h, m] = value.split(':').map(Number); return { h, m }; }
    const now = new Date();
    return { h: now.getHours(), m: now.getMinutes() };
};

// one wheel of numbers 0..count-1: slide it, or touch a number; it settles on a number
function Wheel({ count, value, onChange }) {
    const t = useTheme();
    const ref = useRef(null);
    useEffect(() => {
        const id = setTimeout(() => ref.current?.scrollTo?.({ y: value * ITEM, animated: false }), 40);
        return () => clearTimeout(id);
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    const at = (e) => Math.max(0, Math.min(count - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM)));
    return (
        <View style={{ height: ITEM * ROWS, width: 96 }}>
            <ScrollView
                ref={ref}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM}
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(e) => { const i = at(e); if (i !== value) onChange(i); }}
                onMomentumScrollEnd={(e) => onChange(at(e))}
                contentContainerStyle={{ paddingVertical: ITEM * Math.floor(ROWS / 2) }}
            >
                {Array.from({ length: count }, (_, i) => (
                    <Pressable key={i} onPress={() => { onChange(i); ref.current?.scrollTo?.({ y: i * ITEM, animated: true }); }} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: i === value ? t.text : t.muted, fontSize: i === value ? 28 : 20, fontWeight: i === value ? '900' : '600', opacity: i === value ? 1 : 0.55 }}>{pad(i)}</Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

export function TimePickerSheet({ visible, value, title, onPick, onClose, onType }) {
    const t = useTheme();
    const [h, setH] = useState(0);
    const [m, setM] = useState(0);
    const [k, setK] = useState(0);
    useEffect(() => { if (visible) { const p = parse(value); setH(p.h); setM(p.m); setK((x) => x + 1); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const now = () => { const d = new Date(); setH(d.getHours()); setM(d.getMinutes()); setK((x) => x + 1); };
    const small = { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderColor: t.border, borderRadius: radius.md };
    return (
        <Sheet visible={visible} onClose={onClose} title={title || 'Set the time'}>
            <View style={{ alignItems: 'center' }}>
                <Text style={{ color: t.text, fontSize: 52, fontWeight: '900', letterSpacing: 2 }}>{pad(h)}<Text style={{ color: t.primary }}> : </Text>{pad(m)}</Text>
                <Text style={{ color: t.muted, fontSize: font.xs, marginBottom: spacing.sm }}>24-hour time</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, top: ITEM * Math.floor(ROWS / 2), height: ITEM, borderRadius: radius.md, backgroundColor: tint(t.primary, 0.12), borderWidth: 1, borderColor: tint(t.primary, 0.35) }} />
                    <Wheel key={`h${k}`} count={24} value={h} onChange={setH} />
                    <Text style={{ color: t.muted, fontSize: 26, fontWeight: '900', marginHorizontal: 4 }}>:</Text>
                    <Wheel key={`m${k}`} count={60} value={m} onChange={setM} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: spacing.md, alignSelf: 'stretch' }}>
                    <Pressable onPress={now} hitSlop={6} style={[small, { flex: 1, marginRight: spacing.sm }]}><Icon name="clock" size={16} color={t.primary} /><Text style={{ color: t.text, fontWeight: '800', marginLeft: 6 }}>Now</Text></Pressable>
                    {onType ? <Pressable onPress={onType} hitSlop={6} style={[small, { flex: 2 }]}><Text style={{ color: t.text, fontWeight: '800' }}>Write it myself</Text></Pressable> : null}
                </View>
                <Button title={`Set ${pad(h)}:${pad(m)}`} icon="check" onPress={() => onPick(`${pad(h)}:${pad(m)}`)} style={{ alignSelf: 'stretch', marginTop: spacing.md }} />
            </View>
        </Sheet>
    );
}

// The box. A real text box (he can type), but touching it opens the clock first.
export function TimeField({ label, hint, value, onChange, placeholder = 'HH:MM', title, last }) {
    const t = useTheme();
    const [open, setOpen] = useState(false);
    const input = useRef(null);
    const typing = useRef(false);   // he chose "Write it myself": the next focus is for typing, not for the clock
    const show = () => { input.current?.blur?.(); Keyboard.dismiss(); setOpen(true); };
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, paddingLeft: spacing.md, paddingRight: spacing.sm }}>
                <TextInput
                    ref={input}
                    value={value ?? ''}
                    onChangeText={(x) => onChange(maskTime(x))}
                    onFocus={() => { if (typing.current) { typing.current = false; return; } show(); }}
                    placeholder={placeholder}
                    placeholderTextColor={t.muted}
                    keyboardType="number-pad"
                    maxLength={5}
                    style={{ flex: 1, color: t.text, fontSize: font.md, paddingVertical: 0 }}
                />
                <Pressable onPress={show} hitSlop={8} accessibilityLabel="Set the time" style={{ padding: 6 }}><Icon name="clock" size={20} color={t.muted} /></Pressable>
            </View>
            <TimePickerSheet
                visible={open} value={value} title={title}
                onClose={() => setOpen(false)}
                onPick={(v) => { onChange(v); setOpen(false); }}
                onType={() => { setOpen(false); setTimeout(() => { typing.current = true; input.current?.focus?.(); }, 350); }}
            />
        </View>
    );
}
