// src/screens/FilterDialog.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing, PanResponder, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FadeIn } from '../../components/common/motion';
import { useThemeStore } from '../../store/common/useThemeStore';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { tint } from '../../components/customers/shop';
import { Press } from '../../components/customers/cartParts';
import SlideNum from '../../components/common/SlideNum';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useFilterStore, applyFilters, countActive } from '../../store/customers/useFilterStore';

const SORT_LABELS = {
    popularity: 'Popular',
    rating: 'Rating high to low',
    price_low: 'Price low to high',
    price_high: 'Price high to low',
    prep_time: 'Fastest delivery',
    newest: 'Newest',
};
const SORT_ORDER = ['popularity', 'rating', 'price_low', 'price_high', 'prep_time', 'newest'];

const TYPE_LABELS = [
    ['veg_only', 'Veg only'],
    ['egg_free', 'Eggless'],
    ['bestseller', 'Bestsellers'],
    ['offers', 'Has an offer'],
    ['rating_4', 'Rating 4.0+'],
    ['sugar_free', 'Sugar free'],
    ['jain', 'Jain'],
    ['gift_pack', 'Gift packs'],
    ['new', 'New'],
];

const PRICES = [[1, 'Under ₹150'], [2, '₹150 - ₹300'], [3, 'Above ₹300']];
const SPICES = [['mild', 'Mild'], ['medium', 'Medium'], ['hot', 'Hot']];
const SERVES = [2, 4, 6];

// same colour with zero opacity, so colour fades never pass through black
const clearOf = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? `${c}00` : 'rgba(0,0,0,0)');

// colour fade; skips the first render so opening the dialog does no extra work
function useFade(on, ms = 220) {
    const a = useRef(new Animated.Value(on ? 1 : 0)).current;
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return undefined; }
        Animated.timing(a, { toValue: on ? 1 : 0, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
        return undefined;
    }, [on]);
    return a;
}

function Mark({ on, radio }) {
    const { primary } = useBrand();
    const v = useRef(new Animated.Value(on ? 1 : 0)).current;
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        Animated.spring(v, { toValue: on ? 1 : 0, friction: 6, tension: 170, useNativeDriver: true }).start();
    }, [on]);
    return (
        <View style={[s.mark, radio ? s.markR : s.markC, { borderColor: on ? primary : '#BBBBBB', backgroundColor: !radio && on ? primary : 'transparent' }]}>
            <Animated.View style={{ opacity: v, transform: [{ scale: v }] }}>
                {radio ? <View style={[s.dot, { backgroundColor: primary }]} /> : <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
            </Animated.View>
        </View>
    );
}

function Opt({ on, label, onPress, radio }) {
    const { primary, text } = useBrand();
    const a = useFade(on);
    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [clearOf(primary), tint(primary)] });
    return (
        <Press onPress={onPress}>
            <Animated.View style={[s.opt, { backgroundColor: bg }]}>
                <Mark on={on} radio={radio} />
                <Text style={[s.optTxt, { color: text }]}>{label}</Text>
            </Animated.View>
        </Press>
    );
}

function Pill({ on, label, onPress }) {
    const { primary, text, border } = useBrand();
    const a = useFade(on);
    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [clearOf(primary), tint(primary)] });
    const bd = a.interpolate({ inputRange: [0, 1], outputRange: [border, primary] });
    const fg = a.interpolate({ inputRange: [0, 1], outputRange: [text, primary] });
    return (
        <Press onPress={onPress} style={{ marginRight: 8, marginBottom: 8 }}>
            <Animated.View style={[s.pill, { backgroundColor: bg, borderColor: bd }]}>
                <Animated.Text style={[s.pillTxt, { color: fg }]}>{label}</Animated.Text>
            </Animated.View>
        </Press>
    );
}

// Sections rise one after another, driven by one native value (no re-render while opening)
function Section({ title, index, sect, children }) {
    const { text } = useBrand();
    const lo = Math.min(index * 0.12, 0.5);
    const t = sect.interpolate({ inputRange: [lo, lo + 0.5], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
        <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
            <Text style={[s.h, { color: text }]}>{title}</Text>
            {children}
        </Animated.View>
    );
}

export default function FilterDialog({ visible, onClose, items }) {
    const { primary, radius, text, muted, background, border, surface } = useBrand();
    const insets = useSafeAreaInsets();
    const config = useHomeStore((st) => st.config);
    const minCount = useHomeStore((st) => st.full.ratings.minCount);
    const f = useFilterStore();

    const [show, setShow] = useState(visible);
    const prog = useRef(new Animated.Value(0)).current;
    const sect = useRef(new Animated.Value(0)).current;
    const started = useRef(false);

    // Starts only when the native window is really on screen (onShow), so no frames are dropped
    const play = () => {
        if (started.current) return;
        started.current = true;
        Animated.parallel([
            Animated.timing(prog, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(sect, { toValue: 1, duration: 560, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
    };

    useEffect(() => {
        if (visible) {
            started.current = false;
            prog.setValue(0);
            sect.setValue(0);
            setShow(true);
            const t = setTimeout(play, 350);   // safety, in case onShow never fires
            return () => clearTimeout(t);
        }
        if (show) {
            started.current = true;
            Animated.timing(prog, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setShow(false); });
        }
        return undefined;
    }, [visible]);

    const filters = config.filters || [];
    const sorts = useMemo(
        () => SORT_ORDER.filter((id) => (config.sortOptions || []).includes(id)),
        [config.sortOptions],
    );
    const types = TYPE_LABELS.filter(([id]) => filters.includes(id));

    // weight chips come from the "weight" option group found in the menu items
    const weights = useMemo(() => {
        if (!filters.includes('weight')) return [];
        const seen = new Map();
        (items || []).forEach((p) => {
            (p.optionGroups || []).forEach((g) => {
                if (g.id !== 'weight') return;
                (g.options || []).forEach((o) => { if (!seen.has(o.id)) seen.set(o.id, o.name); });
            });
        });
        return [...seen.entries()];
    }, [items, filters]);

    const count = useMemo(
        () => applyFilters(items || [], f, minCount).length,
        [items, minCount, f.categories, f.active, f.sort, f.price, f.spice, f.serves, f.weight],
    );

    const curSort = f.sort || 'popularity';
    const showSort = sorts.length > 1;
    const active = countActive(f) > 0;
    const clearA = useFade(active);
    const style = useThemeStore((st) => st.theme.filterStyle) || 'dialog';   // dialog | sheet | rail
    const sheetLike = style !== 'dialog';

    // every section once: its title, how many are on, and its options
    const secs = [];
    if (showSort) {
        secs.push({
            key: 'sort', title: 'Sort by', n: f.sort ? 1 : 0,
            body: sorts.map((id) => <Opt key={id} radio on={curSort === id} label={SORT_LABELS[id]} onPress={() => f.setSort(id === 'popularity' ? null : id)} />),
        });
    }
    if (types.length) {
        secs.push({
            key: 'type', title: 'Dish type', n: types.filter(([id]) => f.active.includes(id)).length,
            body: types.map(([id, label]) => <Opt key={id} on={f.active.includes(id)} label={label} onPress={() => f.toggleFilter(id)} />),
        });
    }
    if (filters.includes('price_range')) {
        secs.push({ key: 'price', title: 'Price', n: f.price ? 1 : 0, body: <View style={s.wrapRow}>{PRICES.map(([id, label]) => <Pill key={id} on={f.price === id} label={label} onPress={() => f.setPrice(id)} />)}</View> });
    }
    if (filters.includes('spice_level')) {
        secs.push({ key: 'spice', title: 'Spice', n: f.spice ? 1 : 0, body: <View style={s.wrapRow}>{SPICES.map(([id, label]) => <Pill key={id} on={f.spice === id} label={label} onPress={() => f.setSpice(id)} />)}</View> });
    }
    if (weights.length) {
        secs.push({ key: 'weight', title: 'Weight', n: f.weight ? 1 : 0, body: <View style={s.wrapRow}>{weights.map(([id, name]) => <Pill key={id} on={f.weight === id} label={name} onPress={() => f.setWeight(id)} />)}</View> });
    }
    if (filters.includes('serves')) {
        secs.push({ key: 'serves', title: 'Serves', n: f.serves ? 1 : 0, body: <View style={s.wrapRow}>{SERVES.map((n) => <Pill key={n} on={f.serves === n} label={`${n}+`} onPress={() => f.setServes(n)} />)}</View> });
    }

    // rail: which section is open on the right
    const [tab, setTab] = useState('');
    const openKey = secs.some((x) => x.key === tab) ? tab : (secs[0]?.key || '');
    const openSec = secs.find((x) => x.key === openKey);

    // sheet: drag the handle down to close
    const drag = useRef(new Animated.Value(0)).current;
    useEffect(() => { if (visible) drag.setValue(0); }, [visible]);
    const live = useRef(onClose);
    live.current = onClose;
    const pan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
            if (g.dy > 90 || g.vy > 0.8) {
                Animated.timing(drag, { toValue: 600, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => live.current());
            } else {
                Animated.spring(drag, { toValue: 0, bounciness: 0, speed: 18, useNativeDriver: true }).start();
            }
        },
    })).current;

    const footer = (
        <View style={s.foot}>
            {sheetLike ? (
                <Animated.View pointerEvents={active ? 'auto' : 'none'} style={{ opacity: clearA, width: clearA.interpolate({ inputRange: [0, 1], outputRange: [0, 92] }), overflow: 'hidden' }}>
                    <Pressable onPress={() => f.clear()} style={[s.footClear, { borderColor: border, borderRadius: radius }]}>
                        <Text style={[s.footClearTxt, { color: text }]}>Clear</Text>
                    </Pressable>
                </Animated.View>
            ) : null}
            <Press onPress={onClose} wrap={{ flex: 1 }} style={[s.btn, { backgroundColor: count ? primary : border, borderRadius: radius, marginTop: sheetLike ? 0 : 14 }]}>
                <View style={s.btnRow}>
                    <Text style={[s.btnTxt, !count && { color: text }]}>{count ? 'Show ' : 'No '}</Text>
                    <SlideNum value={count} minWidth={12} style={[s.btnTxt, !count && { color: text }]} />
                    <Text style={[s.btnTxt, !count && { color: text }]}> dish{count === 1 ? '' : 'es'}</Text>
                </View>
            </Press>
        </View>
    );

    const header = (
        <View style={s.top}>
            <Text style={[s.title, { color: text }]}>Filters</Text>
            <View style={s.topR}>
                {!sheetLike ? (
                    <Animated.View pointerEvents={active ? 'auto' : 'none'} style={{ opacity: clearA, transform: [{ scale: clearA.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
                        <Pressable onPress={() => f.clear()} hitSlop={10}>
                            <Text style={[s.clear, { color: primary }]}>Clear all</Text>
                        </Pressable>
                    </Animated.View>
                ) : null}
                <Pressable onPress={onClose} hitSlop={10} style={[s.x, { backgroundColor: surface, borderColor: border }]}>
                    <Ionicons name="close" size={16} color={text} />
                </Pressable>
            </View>
        </View>
    );

    /* ---- the centred dialog (the original) ---- */
    if (!sheetLike) {
        return (
            <Modal visible={show} transparent animationType="none" onShow={play} onRequestClose={onClose} statusBarTranslucent>
                <View style={s.wrap}>
                    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <Animated.View style={[s.card, {
                        backgroundColor: background,
                        opacity: prog,
                        transform: [
                            { translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [50, 0] }) },
                            { scale: prog.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                        ],
                    }]}>
                        {header}
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
                            {secs.map((x, i) => <Section key={x.key} title={x.title} index={i} sect={sect}>{x.body}</Section>)}
                        </ScrollView>
                        {footer}
                    </Animated.View>
                </View>
            </Modal>
        );
    }

    /* ---- bottom sheet: one scrolling list, or a list of sections on the left (rail) ---- */
    const rail = style === 'rail';
    const H = Math.round(Dimensions.get('window').height * (rail ? 0.74 : 0.7));
    const slideY = prog.interpolate({ inputRange: [0, 1], outputRange: [H, 0] });
    return (
        <Modal visible={show} transparent animationType="none" onShow={play} onRequestClose={onClose} statusBarTranslucent>
            <View style={s.sheetWrap}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: prog }]} />
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <Animated.View style={[s.sheet, { height: H, backgroundColor: background, transform: [{ translateY: Animated.add(slideY, drag) }] }]}>
                    <View {...pan.panHandlers} style={s.grabHit}>
                        <View style={[s.grab, { backgroundColor: border }]} />
                    </View>
                    <View style={{ paddingHorizontal: 18 }}>{header}</View>

                    {rail ? (
                        <View style={[s.railWrap, { borderTopColor: border }]}>
                            <View style={[s.rail, { backgroundColor: surface, borderRightColor: border }]}>
                                <ScrollView showsVerticalScrollIndicator={false}>
                                    {secs.map((x) => {
                                        const on = x.key === openKey;
                                        return (
                                            <Pressable key={x.key} onPress={() => setTab(x.key)} style={[s.railItem, on && { backgroundColor: background }]}>
                                                <View style={[s.railBar, { backgroundColor: on ? primary : 'transparent' }]} />
                                                <Text style={[s.railTxt, { color: on ? text : muted, fontWeight: on ? '900' : '700' }]} numberOfLines={1}>{x.title}</Text>
                                                {x.n ? <View style={[s.railN, { backgroundColor: primary }]}><Text style={s.railNTxt}>{x.n}</Text></View> : null}
                                            </Pressable>
                                        );
                                    })}
                                </ScrollView>
                            </View>
                            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                                {openSec ? (
                                    <FadeIn key={openKey} distance={8}>
                                        <Text style={[s.h, { color: text, marginTop: 0 }]}>{openSec.title}</Text>
                                        {openSec.body}
                                    </FadeIn>
                                ) : null}
                            </ScrollView>
                        </View>
                    ) : (
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
                            {secs.map((x, i) => <Section key={x.key} title={x.title} index={i} sect={sect}>{x.body}</Section>)}
                        </ScrollView>
                    )}

                    <View style={[s.sheetFoot, { borderTopColor: border, backgroundColor: surface, paddingBottom: Math.max(insets.bottom, 12) }]}>{footer}</View>
                </Animated.View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
    card: { width: '100%', maxHeight: '82%', borderRadius: 22, padding: 18, elevation: 10 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
    topR: { flexDirection: 'row', alignItems: 'center' },
    title: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
    clear: { fontSize: 13, fontWeight: '800', marginRight: 12 },
    x: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    h: { fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 4 },
    opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
    optTxt: { fontSize: 14, marginLeft: 12, fontWeight: '600' },
    mark: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    markR: { borderRadius: 11 },
    markC: { borderRadius: 6 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    wrapRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
    pill: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    pillTxt: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
    btn: { paddingVertical: 14, alignItems: 'center' },
    foot: { flexDirection: 'row', alignItems: 'center' },
    footClear: { height: 48, width: 84, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
    footClearTxt: { fontSize: 14, fontWeight: '800' },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', elevation: 16 },
    grabHit: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
    grab: { width: 42, height: 4, borderRadius: 2 },
    sheetFoot: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
    railWrap: { flex: 1, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10 },
    rail: { width: 112, borderRightWidth: StyleSheet.hairlineWidth },
    railItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingRight: 10 },
    railBar: { width: 4, height: 22, borderTopRightRadius: 2, borderBottomRightRadius: 2, marginRight: 10 },
    railTxt: { flex: 1, fontSize: 13 },
    railN: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
    railNTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
    btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    btnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});