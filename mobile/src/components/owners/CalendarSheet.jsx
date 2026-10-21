// A small calendar to pick a day, or a range of days (India dates, no future days). mode: 'day' picks at once; 'range' needs two taps and Apply.
// Also: MonthSheet, to pick a whole month.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Button, Chips } from './ui';
import { istToday, dateStr, monthLabel, shortDay } from '../../utils/owners/txRules';
import { tr } from '../../i18n';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function CalendarSheet({ visible, onClose, mode = 'day', title, onPick }) {
    const { text, muted, primary, onPrimary } = useBrand();
    const today = istToday();
    const [view, setView] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
    const [a, setA] = useState(null);
    const [b, setB] = useState(null);
    useEffect(() => { if (visible) { setA(null); setB(null); setView({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

    const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
    const atNow = view.y === Number(today.slice(0, 4)) && view.m === Number(today.slice(5, 7)) - 1;
    const move = (n) => setView((v) => { const t = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });

    const tap = (d) => {
        const s = dateStr(view.y, view.m, d);
        if (s > today) return;
        if (mode === 'day') { onPick({ date: s }); onClose(); return; }
        if (!a || b) { setA(s); setB(null); return; }
        if (s < a) { setB(a); setA(s); } else setB(s);
    };
    const inRange = (s) => a && (b ? s >= a && s <= b : s === a);

    return (
        <Sheet visible={visible} onClose={onClose} title={title || (mode === 'day' ? tr('Pick a day') : tr('Pick the first and the last day'))}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Pressable onPress={() => move(-1)} hitSlop={10} style={{ padding: 8 }}><Ionicons name="chevron-back" size={22} color={text} /></Pressable>
                <Text style={{ flex: 1, textAlign: 'center', color: text, fontWeight: '900', fontSize: 16 }}>{MONTHS[view.m]} {view.y}</Text>
                <Pressable onPress={() => move(1)} hitSlop={10} disabled={atNow} style={{ padding: 8, opacity: atNow ? 0.3 : 1 }}><Ionicons name="chevron-forward" size={22} color={text} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>{WEEK.map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: muted, fontWeight: '700', fontSize: 12, paddingBottom: 6 }}>{w}</Text>)}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cells.map((d, i) => {
                    if (!d) return <View key={'e' + i} style={{ width: '14.285%', height: 42 }} />;
                    const s = dateStr(view.y, view.m, d);
                    const future = s > today;
                    const on = inRange(s);
                    const edge = s === a || s === b;
                    return (
                        <Pressable key={s} onPress={() => tap(d)} disabled={future} style={{ width: '14.285%', height: 42, alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: edge ? primary : on ? alpha(primary, 0.18) : 'transparent', borderWidth: s === today && !on ? 1 : 0, borderColor: primary }}>
                                <Text style={{ color: edge ? onPrimary : future ? alpha(muted, 0.5) : text, fontWeight: edge || s === today ? '900' : '600' }}>{d}</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
            {mode === 'range' ? (
                <View style={{ marginTop: 12 }}>
                    <Text style={{ color: muted, textAlign: 'center', marginBottom: 8 }}>{a ? (b ? `${shortDay(a)}  →  ${shortDay(b)}` : `${shortDay(a)}  →  ${tr('pick the last day')}`) : tr('Tap the first day')}</Text>
                    <Button label={tr('Show these days')} icon="checkmark" disabled={!a} onPress={() => { onPick({ from: a, to: b || a }); onClose(); }} />
                </View>
            ) : null}
        </Sheet>
    );
}

export function MonthSheet({ visible, onClose, onPick }) {
    const { text, muted, primary, onPrimary, border } = useBrand();
    const today = istToday();
    const thisYear = Number(today.slice(0, 4));
    const [year, setYear] = useState(thisYear);
    useEffect(() => { if (visible) setYear(thisYear); }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Pick a month')}>
            <Chips options={[0, 1, 2, 3].map((n) => [thisYear - n, String(thisYear - n)])} value={year} onChange={setYear} style={{ marginTop: 0 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {MONTHS.map((name, i) => {
                    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
                    const future = ym > today.slice(0, 7);
                    return (
                        <Pressable key={ym} disabled={future} onPress={() => { onPick({ month: ym }); onClose(); }} style={{ width: '33.33%', padding: 4, opacity: future ? 0.3 : 1 }}>
                            <View style={{ borderWidth: 1, borderColor: ym === today.slice(0, 7) ? primary : border, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{name.slice(0, 3)}</Text>
                                <Text style={{ color: muted, fontSize: 11 }}>{monthLabel(ym).split(' ')[1]}</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </Sheet>
    );
}
