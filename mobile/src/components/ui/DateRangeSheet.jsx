// src/components/ui/DateRangeSheet.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tint } from './shop';
import { Press } from './cartParts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MAX_BACK = 24;   // months you can go back

const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const same = (a, b) => !!a && !!b && a.getTime() === b.getTime();
const fmt = (k) => {
    const d = fromKey(k);
    const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${d.getDate()} ${SHORT[d.getMonth()]}${y}`;
};
export const rangeLabel = (v) => {
    if (!v || !v.from) return '';
    const to = v.to || v.from;
    return to === v.from ? fmt(v.from) : `${fmt(v.from)} – ${fmt(to)}`;
};

function Day({ d, sel, mid, off, today, onPress }) {
    const { primary, text } = useBrand();
    const a = useRef(new Animated.Value(sel ? 1 : 0)).current;
    const m = useRef(new Animated.Value(mid ? 1 : 0)).current;
    useEffect(() => { Animated.spring(a, { toValue: sel ? 1 : 0, friction: 6, tension: 180, useNativeDriver: true }).start(); }, [sel]);
    useEffect(() => { Animated.timing(m, { toValue: mid ? 1 : 0, duration: 180, useNativeDriver: true }).start(); }, [mid]);
    return (
        <Pressable disabled={off} onPress={onPress} style={s.cell}>
            <Animated.View pointerEvents="none" style={[s.midBg, { backgroundColor: tint(primary), opacity: m }]} />
            <Animated.View pointerEvents="none" style={[s.selDot, { backgroundColor: primary, opacity: a, transform: [{ scale: a }] }]} />
            <Text style={[s.dayTxt, { color: sel ? '#FFFFFF' : off ? '#C4C4C4' : text, fontWeight: sel || today ? '900' : '600' }]}>{d.getDate()}</Text>
            {today && !sel ? <View style={[s.todayDot, { backgroundColor: primary }]} /> : null}
        </Pressable>
    );
}

function Chip({ label, on, onPress }) {
    const { primary, text, border, surface } = useBrand();
    return (
        <Press onPress={onPress} style={[s.chip, { borderColor: on ? primary : border, backgroundColor: on ? tint(primary) : surface }]}>
            <Text style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
        </Press>
    );
}

// value: { from: 'YYYY-MM-DD' | null, to: 'YYYY-MM-DD' | null, sort: 'newest' | 'oldest' } or null
export default function DateRangeSheet({ visible, value, onClose, onApply }) {
    const { primary, text, muted, background, surface, border, radius } = useBrand();
    const today = useMemo(() => sod(new Date()), [visible]);
    const earliest = useMemo(() => new Date(today.getFullYear(), today.getMonth() - MAX_BACK, 1), [today]);

    const [start, setStart] = useState(null);
    const [end, setEnd] = useState(null);
    const [sort, setSort] = useState('newest');
    const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
    const [show, setShow] = useState(visible);
    const prog = useRef(new Animated.Value(0)).current;
    const gridOp = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (visible) {
            const s0 = value?.from ? fromKey(value.from) : null;
            const e0 = value?.to && value.to !== value.from ? fromKey(value.to) : null;
            setStart(s0); setEnd(e0); setSort(value?.sort || 'newest');
            const base = e0 || s0 || today;
            setView({ y: base.getFullYear(), m: base.getMonth() });
            setShow(true);
            prog.setValue(0);
            Animated.timing(prog, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        } else if (show) {
            Animated.timing(prog, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setShow(false); });
        }
    }, [visible]);

    const goto = (y, m) => {
        Animated.timing(gridOp, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
            setView({ y, m });
            Animated.timing(gridOp, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        });
    };
    const step = (n) => { const d = new Date(view.y, view.m + n, 1); goto(d.getFullYear(), d.getMonth()); };
    const canPrev = new Date(view.y, view.m, 1) > earliest;
    const canNext = new Date(view.y, view.m + 1, 1) <= today;

    const pick = (d) => {
        if (!start || end) { setStart(d); setEnd(null); return; }
        if (same(d, start)) return;                 // one day only: just press Apply
        if (d < start) { setEnd(start); setStart(d); } else setEnd(d);
    };
    const preset = (a, b) => { setStart(a); setEnd(same(a, b) ? null : b); goto(b.getFullYear(), b.getMonth()); };
    const clear = () => { setStart(null); setEnd(null); setSort('newest'); };
    const apply = () => {
        if (!start && sort === 'newest') { onApply(null); return; }
        onApply({ from: start ? keyOf(start) : null, to: start ? keyOf(end || start) : null, sort });
    };

    const first = new Date(view.y, view.m, 1);
    const dim = new Date(view.y, view.m + 1, 0).getDate();
    const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: dim }, (_, i) => new Date(view.y, view.m, i + 1))];
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const t = today;
    const PRESETS = [
        ['Today', t, t], ['Yesterday', addDays(t, -1), addDays(t, -1)], ['Last 7 days', addDays(t, -6), t],
        ['Last 30 days', addDays(t, -29), t], ['This month', new Date(t.getFullYear(), t.getMonth(), 1), t],
    ];
    const summary = start ? (end ? `${fmt(keyOf(start))} – ${fmt(keyOf(end))}` : fmt(keyOf(start))) : 'Tap a day, or tap two days for a range';

    return (
        <Modal visible={show} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={s.wrap}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                <Pressable style={{ flex: 1 }} onPress={onClose} />
                <Animated.View style={[s.sheet, { backgroundColor: background, transform: [{ translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [640, 0] }) }] }]}>
                    <View style={[s.handle, { backgroundColor: border }]} />
                    <View style={s.top}>
                        <Text style={[s.title, { color: text }]}>Filter by date</Text>
                        <Pressable onPress={onClose} hitSlop={10} style={[s.x, { backgroundColor: surface, borderColor: border }]}>
                            <Ionicons name="close" size={16} color={text} />
                        </Pressable>
                    </View>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.presets}>
                        {PRESETS.map(([label, a, b]) => (
                            <Chip key={label} label={label} on={same(start, a) && (same(end, b) || (!end && same(a, b)))} onPress={() => preset(a, b)} />
                        ))}
                    </ScrollView>

                    <View style={s.monthRow}>
                        <Pressable disabled={!canPrev} onPress={() => step(-1)} hitSlop={10} style={{ opacity: canPrev ? 1 : 0.3 }}>
                            <Ionicons name="chevron-back" size={22} color={text} />
                        </Pressable>
                        <Text style={[s.month, { color: text }]}>{MONTHS[view.m]} {view.y}</Text>
                        <Pressable disabled={!canNext} onPress={() => step(1)} hitSlop={10} style={{ opacity: canNext ? 1 : 0.3 }}>
                            <Ionicons name="chevron-forward" size={22} color={text} />
                        </Pressable>
                    </View>
                    <View style={s.week}>{DOW.map((x, i) => <Text key={i} style={[s.dow, { color: muted }]}>{x}</Text>)}</View>

                    <Animated.View style={{ opacity: gridOp, minHeight: 6 * 42 }}>
                        {weeks.map((w, wi) => (
                            <View key={wi} style={s.week}>
                                {w.map((d, i) => {
                                    if (!d) return <View key={i} style={s.cell} />;
                                    const isS = same(d, start);
                                    const isE = same(d, end);
                                    const mid = !!start && !!end && d > start && d < end;
                                    return (
                                        <Day key={i} d={d} sel={isS || isE} mid={mid} today={same(d, today)}
                                            off={d > today || d < earliest} onPress={() => pick(d)} />
                                    );
                                })}
                            </View>
                        ))}
                    </Animated.View>

                    <View style={s.sortRow}>
                        <Text style={[s.sortLbl, { color: muted }]}>SORT</Text>
                        <Chip label="Newest first" on={sort === 'newest'} onPress={() => setSort('newest')} />
                        <Chip label="Oldest first" on={sort === 'oldest'} onPress={() => setSort('oldest')} />
                    </View>

                    <Text style={[s.summary, { color: start ? primary : muted }]}>{summary}</Text>
                    <View style={s.foot}>
                        <Press wrap={{ flex: 1, marginRight: 10 }} onPress={clear} style={[s.fBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.fTxt, { color: text }]}>Clear</Text>
                        </Press>
                        <Press wrap={{ flex: 2 }} onPress={apply} style={[s.fBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            <Text style={[s.fTxt, { color: '#FFFFFF' }]}>{start ? 'Show orders' : sort === 'oldest' ? 'Apply' : 'Show all orders'}</Text>
                        </Press>
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    wrap: { flex: 1 },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    title: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
    x: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    presets: { paddingBottom: 6 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderRadius: 18, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
    chipTxt: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
    monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4 },
    month: { fontSize: 16, fontWeight: '900' },
    week: { flexDirection: 'row' },
    dow: { width: '14.2857%', textAlign: 'center', fontSize: 11, fontWeight: '800', paddingBottom: 6 },
    cell: { width: '14.2857%', height: 42, alignItems: 'center', justifyContent: 'center' },
    midBg: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 5 },
    selDot: { position: 'absolute', width: 38, height: 38, borderRadius: 19 },
    dayTxt: { fontSize: 14 },
    todayDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
    sortRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    sortLbl: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginRight: 10 },
    summary: { fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 12 },
    foot: { flexDirection: 'row', marginTop: 12 },
    fBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
    fTxt: { fontSize: 15, fontWeight: '900' },
});