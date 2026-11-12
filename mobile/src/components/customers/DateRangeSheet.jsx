// src/components/ui/DateRangeSheet.jsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { tint, useClosedStyle } from './shop';
import { Press } from './cartParts';
import { tr } from '../../i18n';
import { DragDown, Grip } from '../common/DragDown';
import { SheetPortal } from '../common/SheetPortal';
import { useIsDesktopWeb } from '../../utils/common/layout';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];   // the calendar shows the first letter of each day, in the app language
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
    return `${d.getDate()} ${tr(SHORT[d.getMonth()])}${y}`;
};
export const rangeLabel = (v) => {
    if (!v || !v.from) return '';
    const to = v.to || v.from;
    return to === v.from ? fmt(v.from) : `${fmt(v.from)} – ${fmt(to)}`;
};

// memo + no animation on the first draw: 30-40 of these are drawn when the sheet opens, and that made it slow to appear
const Day = memo(function Day({ d, sel, mid, off, today, onPick }) {
    const { primary, text } = useBrand();
    const a = useRef(new Animated.Value(sel ? 1 : 0)).current;
    const m = useRef(new Animated.Value(mid ? 1 : 0)).current;
    const fresh = useRef(true);
    useEffect(() => {
        if (fresh.current) return;
        Animated.spring(a, { toValue: sel ? 1 : 0, friction: 6, tension: 180, useNativeDriver: true }).start();
    }, [sel]);
    useEffect(() => {
        if (fresh.current) { fresh.current = false; return; }
        Animated.timing(m, { toValue: mid ? 1 : 0, duration: 180, useNativeDriver: true }).start();
    }, [mid]);
    return (
        <Pressable disabled={off} onPress={() => onPick(d)} style={s.cell}>
            <Animated.View pointerEvents="none" style={[s.midBg, { backgroundColor: tint(primary), opacity: m }]} />
            <Animated.View pointerEvents="none" style={[s.selDot, { backgroundColor: primary, opacity: a, transform: [{ scale: a }] }]} />
            <Text style={[s.dayTxt, { color: sel ? '#FFFFFF' : off ? '#C4C4C4' : text, fontWeight: sel || today ? '900' : '600' }]}>{d.getDate()}</Text>
            {today && !sel ? <View style={[s.todayDot, { backgroundColor: primary }]} /> : null}
        </Pressable>
    );
});

function Chip({ label, on, onPress }) {
    const { primary, text, border, surface } = useBrand();
    return (
        <Press onPress={onPress} style={[s.chip, { borderColor: on ? primary : border, backgroundColor: on ? tint(primary) : surface }]}>
            <Text style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
        </Press>
    );
}

// a day in the desktop calendar: a round highlight under the mouse, the chosen days filled, the days between them tinted
const DeskDay = memo(function DeskDay({ d, sel, mid, off, today, onPick, h = 46 }) {
    const { primary, text } = useBrand();
    return (
        <Pressable disabled={off} onPress={() => onPick(d)} style={{ width: '14.2857%', height: h, alignItems: 'center', justifyContent: 'center', cursor: off ? 'default' : 'pointer' }}>
            {({ hovered }) => (
                <>
                    {mid ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, backgroundColor: tint(primary) }} /> : null}
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute', width: Math.min(40, h - 6), height: Math.min(40, h - 6), borderRadius: 20,
                            backgroundColor: sel ? primary : hovered && !off ? `${primary}26` : 'transparent',
                            transitionProperty: 'background-color, filter, transform', transitionDuration: '150ms', transform: [{ scale: hovered && !off && !sel ? 1.06 : 1 }],
                        }}
                    />
                    <Text style={{ fontSize: 14.5, color: sel ? '#FFFFFF' : off ? '#6B6B6B' : text, fontWeight: sel || today ? '900' : '600' }}>{d.getDate()}</Text>
                    {today && !sel ? <View style={{ position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: primary }} /> : null}
                </>
            )}
        </Pressable>
    );
});

// value: { from: 'YYYY-MM-DD' | null, to: 'YYYY-MM-DD' | null, sort: 'newest' | 'oldest' } or null
// single: picks ONE day for a form (value 'YYYY-MM-DD', onApply('YYYY-MM-DD' | null)), from today up to `ahead` days later; no sort row.
// ahead (also for a range): days after today that can be picked, for future bookings. noun: what the button shows ("Show bookings").
// minDay (single only, 'YYYY-MM-DD'): the earliest day that can be picked; the days before it are greyed out (a bulk order needs notice).
export default function DateRangeSheet({ visible, value, onClose, onApply, single, ahead = 0, title, noun, minDay }) {
    const closedStyle = useClosedStyle();   // the shop is closed: this popup turns grey
    const { height: winH } = useWindowDimensions();
    const desk = useIsDesktopWeb();   // a browser at least 1024 px wide: a centred two-panel modal instead of the phone's bottom sheet (false in the phone app)
    const [dMounted, setDMounted] = useState(false);
    const [dOn, setDOn] = useState(false);   // false = parked just outside; the CSS transition does the fade and the slide
    useEffect(() => {
        if (!desk) return undefined;
        if (visible) {
            setDMounted(true);
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setDOn(true)));
            return () => cancelAnimationFrame(id);
        }
        setDOn(false);
        const t = setTimeout(() => setDMounted(false), 260);
        return () => clearTimeout(t);
    }, [visible, desk]);
    useEffect(() => {
        if (!desk || !visible || typeof window === 'undefined') return undefined;
        const key = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [visible, desk, onClose]);
    const { primary, text, muted, background, surface, border, radius } = useBrand();
    const today = useMemo(() => sod(new Date()), [visible]);
    const floor = useMemo(() => { const m = single && /^d{4}-d{2}-d{2}$/.test(minDay || '') ? fromKey(minDay) : null; return m && m > today ? m : today; }, [today, single, minDay]);
    const earliest = useMemo(() => (single ? floor : new Date(today.getFullYear(), today.getMonth() - MAX_BACK, 1)), [today, single, floor]);
    const latest = useMemo(() => (single || ahead ? addDays(today, ahead || 365) : today), [today, single, ahead]);

    const [start, setStart] = useState(null);
    const [end, setEnd] = useState(null);
    const [sort, setSort] = useState('newest');
    const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
    const [show, setShow] = useState(visible);
    const prog = useRef(new Animated.Value(0)).current;
    const gridOp = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (visible) {
            const s0 = single ? (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? fromKey(value) : null) : value?.from ? fromKey(value.from) : null;
            const e0 = single ? null : value?.to && value.to !== value.from ? fromKey(value.to) : null;
            setStart(s0); setEnd(e0); setSort(value?.sort || 'newest');
            const base = e0 || s0 || floor;
            setView({ y: base.getFullYear(), m: base.getMonth() });
            setShow(true);
            prog.setValue(0);   // the slide-in starts when the window is really on screen (onShow below)
        } else if (show) {
            Animated.timing(prog, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setShow(false); });
        }
    }, [visible]);

    const play = () => Animated.timing(prog, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

    const goto = (y, m) => {
        Animated.timing(gridOp, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
            setView({ y, m });
            Animated.timing(gridOp, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        });
    };
    const step = (n) => { const d = new Date(view.y, view.m + n, 1); goto(d.getFullYear(), d.getMonth()); };
    const canPrev = new Date(view.y, view.m, 1) > earliest;
    const canNext = new Date(view.y, view.m + 1, 1) <= latest;

    const pick = (d) => {
        if (single) { setStart(d); setEnd(null); return; }
        if (!start || end) { setStart(d); setEnd(null); return; }
        if (same(d, start)) return;                 // one day only: just press Apply
        if (d < start) { setEnd(start); setStart(d); } else setEnd(d);
    };
    const preset = (a, b) => { setStart(a); setEnd(same(a, b) ? null : b); goto(b.getFullYear(), b.getMonth()); };
    const pickRef = useRef(pick);
    pickRef.current = pick;
    const onDay = useCallback((d) => pickRef.current(d), []);
    const clear = () => { setStart(null); setEnd(null); setSort('newest'); };
    const apply = () => {
        if (single) { onApply(start ? keyOf(start) : null); return; }
        if (!start && sort === 'newest') { onApply(null); return; }
        onApply({ from: start ? keyOf(start) : null, to: start ? keyOf(end || start) : null, sort });
    };

    // the same Date objects for the same month, so the memoised days are not drawn again on every tap
    const weeks = useMemo(() => {
        const first = new Date(view.y, view.m, 1);
        const dim = new Date(view.y, view.m + 1, 0).getDate();
        const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: dim }, (_, i) => new Date(view.y, view.m, i + 1))];
        while (cells.length % 7) cells.push(null);
        const out = [];
        for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
        return out;
    }, [view.y, view.m]);

    const t = today;
    const PRESETS = ahead && !single ? [['Today', t, t], ['Tomorrow', addDays(t, 1), addDays(t, 1)], ['Next 7 days', t, addDays(t, 6)], ['Next 30 days', t, addDays(t, 29)], ['This month', new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)]] : single ? [['Today', t, t], ['Tomorrow', addDays(t, 1), addDays(t, 1)], ['In 3 days', addDays(t, 3), addDays(t, 3)], ['In a week', addDays(t, 7), addDays(t, 7)]] : [
        ['Today', t, t], ['Yesterday', addDays(t, -1), addDays(t, -1)], ['Last 7 days', addDays(t, -6), t],
        ['Last 30 days', addDays(t, -29), t], ['This month', new Date(t.getFullYear(), t.getMonth(), 1), t],
    ];
    const summary = start ? (end ? `${fmt(keyOf(start))} – ${fmt(keyOf(end))}` : fmt(keyOf(start))) : single ? tr('Tap a day') : tr('Tap a day, or tap two days for a range');

    if (desk) {
        if (!dMounted) return null;
        const ease = 'cubic-bezier(0.22, 0.8, 0.2, 1)';
        // 6 week rows share what is left after the fixed parts (padding, title, month bar, weekdays, sort row, footer): 46 px when there is room, down to 34 px
        const cellH = Math.max(34, Math.min(46, Math.floor((winH - 48 - 400) / 6)));
        const hoverBtn = (hovered, extra) => ({ cursor: 'pointer', transitionProperty: 'background-color, border-color, filter, box-shadow', transitionDuration: '160ms', ...extra });
        const arrow = (name, enabled, onPress, label) => (
            <Pressable
                disabled={!enabled}
                onPress={onPress}
                accessibilityLabel={label}
                style={({ hovered }) => ({ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: hovered && enabled ? muted : border, backgroundColor: hovered && enabled ? border : surface, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.35, marginLeft: 8, ...hoverBtn(hovered, { cursor: enabled ? 'pointer' : 'default' }) })}
            >
                <Ionicons name={name} size={19} color={text} />
            </Pressable>
        );
        return (
            <SheetPortal>
                <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }, closedStyle]} pointerEvents={dOn ? 'auto' : 'none'}>
                    <Pressable
                        onPress={onClose}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', opacity: dOn ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '260ms' }}
                    />
                    <View
                        style={{
                            width: '100%', maxWidth: 780, maxHeight: winH - 48, borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 28, boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
                            opacity: dOn ? 1 : 0, transform: [{ scale: dOn ? 1 : 0.95 }, { translateY: dOn ? 0 : 14 }],
                            transitionProperty: 'opacity, filter, transform', transitionDuration: '260ms', transitionTimingFunction: ease,
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontSize: 26, fontWeight: '900', letterSpacing: -0.4 }}>{title || tr('Filter by date')}</Text>
                                <Text style={{ color: muted, fontSize: 14, marginTop: 4 }}>{single ? tr('Tap a day') : tr('Tap a day, or tap two days for a range')}</Text>
                            </View>
                            <Pressable
                                onPress={onClose}
                                hitSlop={8}
                                accessibilityLabel={tr('Close')}
                                style={({ hovered }) => ({ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: hovered ? muted : border, backgroundColor: hovered ? border : background, alignItems: 'center', justifyContent: 'center', ...hoverBtn(hovered) })}
                            >
                                <Ionicons name="close" size={19} color={text} />
                            </Pressable>
                        </View>

                        <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                        <View style={{ flexDirection: 'row', marginTop: 24 }}>
                            {/* quick picks */}
                            <View style={{ width: 200, paddingRight: 24, marginRight: 24, borderRightWidth: 1, borderRightColor: border }}>
                                <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: 10 }}>{tr('QUICK PICKS')}</Text>
                                {PRESETS.map(([label, a, b]) => {
                                    const on = same(start, a) && (same(end, b) || (!end && same(a, b)));
                                    return (
                                        <Pressable
                                            key={label}
                                            onPress={() => preset(a, b)}
                                            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4, backgroundColor: on ? tint(primary) : hovered ? `${primary}12` : 'transparent', borderWidth: 1, borderColor: on ? primary : 'transparent', ...hoverBtn(hovered) })}
                                        >
                                            <Text style={{ flex: 1, color: on ? primary : text, fontSize: 14, fontWeight: on ? '800' : '600' }}>{tr(label)}</Text>
                                            {on ? <Ionicons name="checkmark" size={16} color={primary} /> : null}
                                        </Pressable>
                                    );
                                })}
                            </View>

                            {/* the calendar */}
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                    <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '900' }}>{tr(MONTHS[view.m])} {view.y}</Text>
                                    {arrow('chevron-back', canPrev, () => step(-1), tr('Previous month'))}
                                    {arrow('chevron-forward', canNext, () => step(1), tr('Next month'))}
                                </View>
                                <View style={s.week}>{DOW.map((x, i) => <Text key={i} style={{ width: '14.2857%', textAlign: 'center', color: muted, fontSize: 12, fontWeight: '800', paddingBottom: 8 }}>{tr(x)}</Text>)}</View>
                                <Animated.View style={{ opacity: gridOp, minHeight: 6 * cellH }}>
                                    {weeks.map((w, wi) => (
                                        <View key={wi} style={s.week}>
                                            {w.map((d, i) => {
                                                if (!d) return <View key={i} style={{ width: '14.2857%', height: cellH }} />;
                                                const isS = same(d, start);
                                                const isE = same(d, end);
                                                const mid = !!start && !!end && d > start && d < end;
                                                return <DeskDay key={i} d={d} h={cellH} sel={isS || isE} mid={mid} today={same(d, today)} off={d > latest || d < earliest} onPick={onDay} />;
                                            })}
                                        </View>
                                    ))}
                                </Animated.View>
                                {single ? null : (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                                        <Text style={{ color: muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginRight: 12 }}>{tr('SORT')}</Text>
                                        {[['newest', 'Newest first'], ['oldest', 'Oldest first']].map(([k, label]) => {
                                            const on = sort === k;
                                            return (
                                                <Pressable
                                                    key={k}
                                                    onPress={() => setSort(k)}
                                                    style={({ hovered }) => ({ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1.5, marginRight: 8, borderColor: on || hovered ? primary : border, backgroundColor: on ? tint(primary) : hovered ? `${primary}12` : 'transparent', ...hoverBtn(hovered) })}
                                                >
                                                    <Text style={{ color: on ? primary : text, fontSize: 13, fontWeight: '800' }}>{tr(label)}</Text>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                )}
                            </View>
                        </View>
                        </ScrollView>

                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderTopColor: border }}>
                            <Text style={{ flex: 1, color: start ? primary : muted, fontSize: 14, fontWeight: '800' }}>{summary}</Text>
                            <Pressable
                                onPress={clear}
                                style={({ hovered }) => ({ height: 48, paddingHorizontal: 26, borderRadius: radius, borderWidth: 1.5, borderColor: hovered ? muted : border, backgroundColor: hovered ? border : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 12, ...hoverBtn(hovered) })}
                            >
                                <Text style={{ color: text, fontSize: 15, fontWeight: '900' }}>{tr('Clear')}</Text>
                            </Pressable>
                            <Pressable
                                onPress={apply}
                                style={({ hovered }) => ({ height: 48, minWidth: 170, paddingHorizontal: 26, borderRadius: radius, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', filter: hovered ? 'brightness(1.12)' : 'brightness(1)', boxShadow: hovered ? `0 10px 26px ${primary}55` : '0 0 0 rgba(0,0,0,0)', ...hoverBtn(hovered) })}
                            >
                                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '900' }}>{single ? tr('Done') : start ? tr(noun ? 'Show bookings' : 'Show orders') : sort === 'oldest' ? tr('Apply') : tr(noun ? 'Show all bookings' : 'Show all orders')}</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </SheetPortal>
        );
    }

    return (
        <Modal visible={show} transparent animationType="none" onShow={play} onRequestClose={onClose} statusBarTranslucent>
            <View style={[s.wrap, closedStyle]}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                <Pressable style={{ flex: 1 }} onPress={onClose} />
                <DragDown visible={visible} onClose={onClose}>
                <Animated.View style={[s.sheet, { backgroundColor: background, transform: [{ translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [640, 0] }) }] }]}>
                    <Grip>
                    <View style={[s.handle, { backgroundColor: border }]} />
                    <View style={s.top}>
                        <Text style={[s.title, { color: text }]}>{title || tr('Filter by date')}</Text>
                        <Pressable onPress={onClose} hitSlop={10} style={[s.x, { backgroundColor: surface, borderColor: border }]}>
                            <Ionicons name="close" size={16} color={text} />
                        </Pressable>
                    </View>
                    </Grip>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.presets}>
                        {PRESETS.map(([label, a, b]) => (
                            <Chip key={label} label={tr(label)} on={same(start, a) && (same(end, b) || (!end && same(a, b)))} onPress={() => preset(a, b)} />
                        ))}
                    </ScrollView>

                    <View style={s.monthRow}>
                        <Pressable disabled={!canPrev} onPress={() => step(-1)} hitSlop={10} style={{ opacity: canPrev ? 1 : 0.3 }}>
                            <Ionicons name="chevron-back" size={22} color={text} />
                        </Pressable>
                        <Text style={[s.month, { color: text }]}>{tr(MONTHS[view.m])} {view.y}</Text>
                        <Pressable disabled={!canNext} onPress={() => step(1)} hitSlop={10} style={{ opacity: canNext ? 1 : 0.3 }}>
                            <Ionicons name="chevron-forward" size={22} color={text} />
                        </Pressable>
                    </View>
                    <View style={s.week}>{DOW.map((x, i) => <Text key={i} style={[s.dow, { color: muted }]}>{Array.from(tr(x))[0]}</Text>)}</View>

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
                                            off={d > latest || d < earliest} onPick={onDay} />
                                    );
                                })}
                            </View>
                        ))}
                    </Animated.View>

                    {single ? null : (
                        <View style={s.sortRow}>
                            <Text style={[s.sortLbl, { color: muted }]}>{tr('SORT')}</Text>
                            <Chip label={tr('Newest first')} on={sort === 'newest'} onPress={() => setSort('newest')} />
                            <Chip label={tr('Oldest first')} on={sort === 'oldest'} onPress={() => setSort('oldest')} />
                        </View>
                    )}

                    <Text style={[s.summary, { color: start ? primary : muted }]}>{summary}</Text>
                    <View style={s.foot}>
                        <Press wrap={{ flex: 1, marginRight: 10 }} onPress={clear} style={[s.fBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.fTxt, { color: text }]}>{tr('Clear')}</Text>
                        </Press>
                        <Press wrap={{ flex: 2 }} onPress={apply} style={[s.fBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            <Text style={[s.fTxt, { color: '#FFFFFF' }]}>{single ? tr('Done') : start ? tr(noun ? 'Show bookings' : 'Show orders') : sort === 'oldest' ? tr('Apply') : tr(noun ? 'Show all bookings' : 'Show all orders')}</Text>
                        </Press>
                    </View>
                </Animated.View>
                </DragDown>
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