// A day, picked from sliding wheels (day, month, year) instead of the keyboard. Same look as the clock (TimePicker.jsx).
//   <DatePickField label value="2026-11-07" onChange /> looks like a text box: touch it and the sheet opens (the keyboard stays down).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Keyboard } from 'react-native';
import { useTheme, spacing, radius, font, tint, TAP } from '../theme';
import { Sheet } from './feedback';
import { Button } from './ui';
import { Label } from './settingsForm';
import Icon from './Icon';

const ITEM = 46;
const ROWS = 5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();   // m: 0..11
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Wheel({ items, index, onChange, width }) {
    const t = useTheme();
    const ref = useRef(null);
    useEffect(() => {
        const id = setTimeout(() => ref.current?.scrollTo?.({ y: index * ITEM, animated: false }), 40);
        return () => clearTimeout(id);
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    const at = (e) => Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM)));
    return (
        <View style={{ height: ITEM * ROWS, width }}>
            <ScrollView
                ref={ref}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM}
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(e) => { const i = at(e); if (i !== index) onChange(i); }}
                onMomentumScrollEnd={(e) => onChange(at(e))}
                contentContainerStyle={{ paddingVertical: ITEM * Math.floor(ROWS / 2) }}
            >
                {items.map((label, i) => (
                    <Pressable key={label} onPress={() => { onChange(i); ref.current?.scrollTo?.({ y: i * ITEM, animated: true }); }} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: i === index ? t.text : t.muted, fontSize: i === index ? 26 : 19, fontWeight: i === index ? '900' : '600', opacity: i === index ? 1 : 0.55 }}>{label}</Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

export function DatePickerSheet({ visible, value, title, onPick, onClose }) {
    const t = useTheme();
    const thisYear = new Date().getFullYear();
    const years = [thisYear, thisYear + 1, thisYear + 2];
    const [y, setY] = useState(0);
    const [m, setM] = useState(0);
    const [d, setD] = useState(0);   // 0-based day
    const [k, setK] = useState(0);
    const load = (v) => {
        const base = DATE_RE.test(v || '') ? new Date(`${v}T12:00:00`) : new Date();
        setY(Math.max(0, Math.min(years.length - 1, base.getFullYear() - thisYear)));
        setM(base.getMonth());
        setD(base.getDate() - 1);
        setK((x) => x + 1);
    };
    useEffect(() => { if (visible) load(value); }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const max = daysIn(years[y], m);
    const day = Math.min(d, max - 1);
    const picked = `${years[y]}-${pad(m + 1)}-${pad(day + 1)}`;
    const small = { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderWidth: 1, borderColor: t.border, borderRadius: radius.md };
    const jump = (n) => { const x = new Date(); x.setDate(x.getDate() + n); setY(Math.max(0, Math.min(years.length - 1, x.getFullYear() - thisYear))); setM(x.getMonth()); setD(x.getDate() - 1); setK((z) => z + 1); };
    return (
        <Sheet visible={visible} onClose={onClose} title={title || 'Pick the date'}>
            <View style={{ alignItems: 'center' }}>
                <Text style={{ color: t.text, fontSize: 30, fontWeight: '900' }}>{pad(day + 1)} <Text style={{ color: t.primary }}>{MONTHS[m]}</Text> {years[y]}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm }}>
                    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, top: ITEM * Math.floor(ROWS / 2), height: ITEM, borderRadius: radius.md, backgroundColor: tint(t.primary, 0.12), borderWidth: 1, borderColor: tint(t.primary, 0.35) }} />
                    <Wheel key={`d${k}`} items={Array.from({ length: max }, (_, i) => pad(i + 1))} index={day} onChange={setD} width={84} />
                    <Wheel key={`m${k}`} items={MONTHS} index={m} onChange={setM} width={96} />
                    <Wheel key={`y${k}`} items={years.map(String)} index={y} onChange={setY} width={96} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: spacing.md, alignSelf: 'stretch' }}>
                    <Pressable onPress={() => jump(0)} hitSlop={6} style={[small, { flex: 1, marginRight: spacing.sm }]}><Text style={{ color: t.text, fontWeight: '800' }}>Today</Text></Pressable>
                    <Pressable onPress={() => jump(1)} hitSlop={6} style={[small, { flex: 1 }]}><Text style={{ color: t.text, fontWeight: '800' }}>Tomorrow</Text></Pressable>
                </View>
                <Button title={`Set ${pad(day + 1)} ${MONTHS[m]} ${years[y]}`} icon="check" onPress={() => onPick(picked)} style={{ alignSelf: 'stretch', marginTop: spacing.md }} />
            </View>
        </Sheet>
    );
}

// The box: touching it opens the wheels (no keyboard).
export function DatePickField({ label, hint, value, onChange, title, last }) {
    const t = useTheme();
    const [open, setOpen] = useState(false);
    const show = () => { Keyboard.dismiss(); setOpen(true); };
    const shown = DATE_RE.test(value || '') ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Pick the date';
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <Pressable onPress={show} style={{ flexDirection: 'row', alignItems: 'center', minHeight: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, paddingLeft: spacing.md, paddingRight: spacing.sm }}>
                <Text style={{ flex: 1, color: DATE_RE.test(value || '') ? t.text : t.muted, fontSize: font.md }}>{shown}</Text>
                <Icon name="calendar" size={20} color={t.muted} />
            </Pressable>
            <DatePickerSheet visible={open} value={value} title={title} onClose={() => setOpen(false)} onPick={(v) => { onChange(v); setOpen(false); }} />
        </View>
    );
}

export { ymd };
