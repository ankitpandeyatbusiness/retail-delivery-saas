// A time of day, set from a digital clock instead of the keyboard (24-hour, 1-minute steps).
//   <TimeInput value="19:30" onChange={...} />  looks like a text box: touch it and the clock sheet opens (the keyboard stays down);
//   the clock icon opens it again, and "Write it myself" in the sheet closes it and lets him type (numbers only, like 19:30).
//   <TimePickerSheet visible value onPick onClose />  the sheet alone: two wheels (hour, minute) under a big readout.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from './kit';
import { Sheet, Button } from '../owners/ui';
import { tr } from '../../i18n';

const ITEM = 46;      // the height of one number on a wheel
const ROWS = 5;       // numbers in view: the middle one is the chosen one
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
    const { text, muted } = useBrand();
    const ref = useRef(null);
    useEffect(() => {   // start on the chosen number
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
                onMomentumScrollEnd={(e) => { const i = at(e); onChange(i); }}
                contentContainerStyle={{ paddingVertical: ITEM * Math.floor(ROWS / 2) }}
            >
                {Array.from({ length: count }, (_, i) => (
                    <Pressable key={i} onPress={() => { onChange(i); ref.current?.scrollTo?.({ y: i * ITEM, animated: true }); }} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: i === value ? text : muted, fontSize: i === value ? 28 : 20, fontWeight: i === value ? '900' : '600', opacity: i === value ? 1 : 0.55 }}>{pad(i)}</Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

export function TimePickerSheet({ visible, value, title, optional, onPick, onClose, onType }) {
    const { text, muted, primary, border } = useBrand();
    const [h, setH] = useState(0);
    const [m, setM] = useState(0);
    const [k, setK] = useState(0);   // a new key sets the wheels back to the start (after "Now")
    useEffect(() => { if (visible) { const p = parse(value); setH(p.h); setM(p.m); setK((x) => x + 1); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const now = () => { const d = new Date(); setH(d.getHours()); setM(d.getMinutes()); setK((x) => x + 1); };
    return (
        <Sheet visible={visible} onClose={onClose} title={title || tr('Set the time')} noPull>
            <View style={{ alignItems: 'center' }}>
                <Text style={{ color: text, fontSize: 52, fontWeight: '900', letterSpacing: 2, fontVariant: ['tabular-nums'] }}>{pad(h)}<Text style={{ color: primary }}> : </Text>{pad(m)}</Text>
                <Text style={{ color: muted, fontSize: 12, marginBottom: 8 }}>{tr('24-hour time')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ position: 'absolute', left: 16, right: 16, top: ITEM * Math.floor(ROWS / 2), height: ITEM, borderRadius: 14, backgroundColor: alpha(primary, 0.12), borderWidth: 1, borderColor: alpha(primary, 0.35) }} pointerEvents="none" />
                    <Wheel key={`h${k}`} count={24} value={h} onChange={setH} />
                    <Text style={{ color: muted, fontSize: 26, fontWeight: '900', marginHorizontal: 4 }}>:</Text>
                    <Wheel key={`m${k}`} count={60} value={m} onChange={setM} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: 14, alignSelf: 'stretch' }}>
                    <Pressable onPress={now} hitSlop={6} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderColor: border, borderRadius: 14, marginRight: 8 }}>
                        <Ionicons name="time-outline" size={16} color={primary} /><Text style={{ color: text, fontWeight: '800', marginLeft: 6 }}>{tr('Now')}</Text>
                    </Pressable>
                    {onType ? (
                        <Pressable onPress={onType} hitSlop={6} style={{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderColor: border, borderRadius: 14 }}>
                            <Ionicons name="keypad-outline" size={16} color={primary} /><Text style={{ color: text, fontWeight: '800', marginLeft: 6 }}>{tr('Write it myself')}</Text>
                        </Pressable>
                    ) : null}
                </View>
                <View style={{ flexDirection: 'row', marginTop: 12, alignSelf: 'stretch' }}>
                    {optional && value ? <Button label={tr('Clear')} kind="ghost" onPress={() => onPick('')} style={{ flex: 1, marginRight: 8 }} /> : null}
                    <Button label={tr('Set {t}', { t: `${pad(h)}:${pad(m)}` })} icon="checkmark" onPress={() => onPick(`${pad(h)}:${pad(m)}`)} style={{ flex: 2 }} />
                </View>
            </View>
        </Sheet>
    );
}

// The box. A real text box (he can type), but touching it opens the clock first.
export function TimeInput({ value, onChange, placeholder = 'HH:MM', title, optional, center, style, boxStyle }) {
    const { text, muted, border, surface } = useBrand();
    const [open, setOpen] = useState(false);
    const input = useRef(null);
    const typing = useRef(false);   // he chose "Write it myself": the next focus is for typing, not for the clock
    const show = () => { input.current?.blur?.(); Keyboard.dismiss(); setOpen(true); };
    return (
        <View style={style}>
            <View style={[{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 12, backgroundColor: surface, minHeight: 46, paddingLeft: 14, paddingRight: 8 }, boxStyle]}>
                <TextInput
                    ref={input}
                    value={value || ''}
                    onChangeText={(x) => onChange(maskTime(x))}
                    onFocus={() => { if (typing.current) { typing.current = false; return; } show(); }}
                    placeholder={placeholder}
                    placeholderTextColor={muted}
                    keyboardType="number-pad"
                    maxLength={5}
                    style={{ flex: 1, color: text, fontSize: 15, paddingVertical: 10, textAlign: center ? 'center' : 'left' }}
                />
                <Pressable onPress={show} hitSlop={8} accessibilityLabel={tr('Set the time')} style={{ padding: 6 }}><Ionicons name="time-outline" size={20} color={muted} /></Pressable>
            </View>
            <TimePickerSheet
                visible={open} value={value} title={title} optional={optional}
                onClose={() => setOpen(false)}
                onPick={(v) => { onChange(v); setOpen(false); }}
                onType={() => { setOpen(false); setTimeout(() => { typing.current = true; input.current?.focus?.(); }, 350); }}
            />
        </View>
    );
}

// A time shown as text that opens the clock when touched (for the +/- steppers, where there is no box to type in)
export function TimeText({ value, onChange, title, style, textStyle }) {
    const [open, setOpen] = useState(false);
    const { text } = useBrand();
    return (
        <>
            <Pressable onPress={() => setOpen(true)} style={style} hitSlop={6}><Text style={[{ color: text, fontWeight: '900', fontSize: 15, textAlign: 'center' }, textStyle]}>{value}</Text></Pressable>
            <TimePickerSheet visible={open} value={value} title={title} onClose={() => setOpen(false)} onPick={(v) => { onChange(v); setOpen(false); }} />
        </>
    );
}
