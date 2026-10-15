// src/components/ui/finder.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Animated, Easing, Modal, StyleSheet, InteractionManager } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useBrand } from '../common/kit';
import { ask } from '../common/dialog';
import { FadeIn } from '../common/motion';
import { SkelCats } from './skeletons';
import { useThemeStore } from '../../store/common/useThemeStore';
import { tint, showToast } from './shop';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useFilterStore, countActive } from '../../store/customers/useFilterStore';
import { useMenuStore } from '../../store/customers/shopStores';

/* ---------- smooth collapse (height + fade) ---------- */
export function Collapse({ hide, children }) {
    const p = useRef(new Animated.Value(hide ? 0 : 1)).current;
    const [h, setH] = useState(null);
    useEffect(() => {
        Animated.timing(p, { toValue: hide ? 0 : 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [hide]);
    const height = h == null ? (hide ? 0 : undefined) : p.interpolate({ inputRange: [0, 1], outputRange: [0, h] });
    return (
        <Animated.View style={{ height, opacity: p, overflow: 'hidden' }}>
            <View
                onLayout={(e) => { const nh = Math.round(e.nativeEvent.layout.height); if (nh > 0 && nh !== h) setH(nh); }}
                style={h == null ? undefined : s.abs}
            >
                {children}
            </View>
        </Animated.View>
    );
}

/* ---------- strip that fades out, then disappears (and the reverse). No per-frame re-layout ---------- */
export function FadeCollapse({ hide, children }) {
    const o = useRef(new Animated.Value(hide ? 0 : 1)).current;
    const [gone, setGone] = useState(hide);
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return undefined; }
        let alive = true;
        if (hide) {
            Animated.timing(o, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => { if (finished && alive) setGone(true); });
        } else {
            setGone(false);
            o.setValue(0);
            Animated.timing(o, { toValue: 1, duration: 260, delay: 60, useNativeDriver: true }).start();
        }
        return () => { alive = false; };
    }, [hide]);
    if (gone) return null;
    return <Animated.View style={{ opacity: o }}>{children}</Animated.View>;
}

/* ---------- fade in whenever k changes ---------- */
export function Fade({ k, children }) {
    const a = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        a.setValue(0);
        Animated.timing(a, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }, [k]);
    return <Animated.View style={{ flex: 1, opacity: a }}>{children}</Animated.View>;
}

/* ---------- rolling placeholder ---------- */
const PH_H = 20;
export function Slider({ names }) {
    const { muted } = useBrand();
    const p = useRef(new Animated.Value(0)).current;
    const [i, setI] = useState(0);
    const key = names.join('|');

    useEffect(() => {
        setI(0);
        p.setValue(0);
        if (names.length < 2) return undefined;
        let cur = 0;
        const t = setInterval(() => {
            Animated.timing(p, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
                if (!finished) return;
                cur = (cur + 1) % names.length;
                p.setValue(0);
                setI(cur);
            });
        }, 3000);
        return () => { clearInterval(t); p.stopAnimation(); };
    }, [key]);

    if (!names.length) return <Text style={[s.ph, { color: muted }]}>Search dishes</Text>;

    const a = names[i % names.length];
    const b = names[(i + 1) % names.length];
    const outY = p.interpolate({ inputRange: [0, 1], outputRange: [0, -PH_H] });
    const inY = p.interpolate({ inputRange: [0, 1], outputRange: [PH_H, 0] });
    const outO = p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

    return (
        <View style={s.phBox}>
            <Animated.Text numberOfLines={1} style={[s.phTxt, { color: muted, opacity: outO, transform: [{ translateY: outY }] }]}>
                Search "{a}"
            </Animated.Text>
            <Animated.Text numberOfLines={1} style={[s.phTxt, s.phAbs, { color: muted, opacity: p, transform: [{ translateY: inY }] }]}>
                Search "{b}"
            </Animated.Text>
        </View>
    );
}

/* ---------- veg switch ---------- */
// A single pill: the label on one side, the knob (with the veg mark) on the other.
// Everything that moves runs on the native driver (position and opacity only), and the visual change starts the
// instant the finger lifts. The actual filter is applied after the slide has finished, so the heavy list update
// can never make the switch stutter.
export function VegSwitch({ on, onPress }) {
    const { surface, border, muted } = useBrand();
    const [shown, setShown] = useState(on);           // what the switch draws right now
    const x = useRef(new Animated.Value(on ? 1 : 0)).current;
    const busy = useRef(false);

    // someone else changed the filter (Home / Search share it): follow it
    useEffect(() => {
        setShown(on);
        Animated.timing(x, { toValue: on ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [on]);

    const press = () => {
        if (busy.current) return;
        // switching OFF asks first, like Zomato: the switch only moves if the customer confirms
        if (shown) {
            // themed dialog: the brand-coloured button keeps veg on, the outlined one turns it off
            ask({
                title: 'Turn off veg mode?',
                message: 'You will start seeing non-veg dishes again in the menu, bestsellers and search.',
                icon: 'leaf-outline',
                confirmText: 'Keep veg only',
                cancelText: 'Turn off',
            }).then((keep) => { if (!keep) commit(false); });
            return;
        }
        commit(true);
    };

    const commit = (next) => {
        if (busy.current) return;
        busy.current = true;
        setShown(next);
        Animated.timing(x, { toValue: next ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        InteractionManager.runAfterInteractions(() => {
            busy.current = false;
            onPress();
        });
    };

    const knobX = x.interpolate({ inputRange: [0, 1], outputRange: [0, 38] });
    const offOp = x.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    return (
        <Pressable onPress={press} hitSlop={8} style={s.vegWrap} accessibilityRole="switch" accessibilityState={{ checked: shown }} accessibilityLabel="Veg only">
            <View style={[s.vPill, { backgroundColor: surface, borderColor: border }]}>
                {/* the green fill fades in over the pill */}
                <Animated.View pointerEvents="none" style={[s.vFill, { opacity: x }]} />
                <Animated.Text style={[s.vLabel, { left: 34, color: muted, opacity: offOp }]}>VEG</Animated.Text>
                <Animated.Text style={[s.vLabel, { left: 12, color: '#FFFFFF', opacity: x }]}>VEG</Animated.Text>
                <Animated.View style={[s.vKnob, { transform: [{ translateX: knobX }] }]}>
                    <View style={[s.vMark, { borderColor: '#8A8F98' }]}><View style={[s.vMarkDot, { backgroundColor: '#8A8F98' }]} /></View>
                    <Animated.View style={[StyleSheet.absoluteFill, s.vMarkOn, { opacity: x }]}>
                        <View style={[s.vMark, { borderColor: '#0F8A3C' }]}><View style={[s.vMarkDot, { backgroundColor: '#0F8A3C' }]} /></View>
                    </Animated.View>
                </Animated.View>
            </View>
        </Pressable>
    );
}

/* ---------- categories: multi-select with Clear all ---------- */
const clearOf = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? `${c}00` : 'rgba(0,0,0,0)');

// The highlight animations below only use opacity and scale, so they run on the native thread: they stay smooth
// even while the list underneath is busy changing.
function useOn(on, ms = 200) {
    const a = useRef(new Animated.Value(on ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(a, { toValue: on ? 1 : 0, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [on]);
    return a;
}

function CatItem({ c, on, onPress }) {
    const { primary, onPrimary, text, soft } = useBrand();
    const a = useOn(on);
    const p = useRef(new Animated.Value(1)).current;
    const to = (v) => Animated.spring(p, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable onPress={onPress} onPressIn={() => to(0.93)} onPressOut={() => to(1)} style={s.cat}>
            <Animated.View style={{ transform: [{ scale: p }], alignItems: 'center' }}>
                <View style={[s.catRing, { borderColor: 'transparent' }]}>
                    {/* the brand ring fades in over the plain one */}
                    <Animated.View pointerEvents="none" style={[s.edge, { borderRadius: 36, borderColor: primary, opacity: a }]} />
                    <View style={[s.catCircle, { backgroundColor: soft }]}>
                        {c.image ? <Image source={{ uri: c.image }} style={s.catImg} contentFit="cover" />
                            : <Text style={{ fontWeight: '800', color: primary, fontSize: 22 }}>{(c.name || '?')[0].toUpperCase()}</Text>}
                    </View>
                </View>
                <Animated.View style={[s.catX, { backgroundColor: primary, opacity: a, transform: [{ scale: a }] }]}>
                    <Ionicons name="close" size={11} color={onPrimary} />
                </Animated.View>
                <Text numberOfLines={1} style={[s.catName, { color: on ? primary : text, fontWeight: '700' }]}>{c.name}</Text>
            </Animated.View>
        </Pressable>
    );
}

/* photo tile: the dish photo with the name on a shade; the selected one lifts and gets a brand border + check */
function CatTile({ c, on, onPress }) {
    const { primary, onPrimary, text, soft } = useBrand();
    const a = useOn(on);
    const p = useRef(new Animated.Value(1)).current;
    const to = (v) => Animated.spring(p, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)} style={s.tileWrap}>
            <Animated.View style={{ transform: [{ scale: p }] }}>
                <View style={[s.tile, { backgroundColor: soft, borderColor: 'transparent' }]}>
                    <Animated.View pointerEvents="none" style={[s.edge, { borderRadius: 18, borderColor: primary, opacity: a, zIndex: 2 }]} />
                    {c.image ? (
                        <>
                            <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                            <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={s.tileShade} />
                        </>
                    ) : (
                        <Text style={[s.tileInitial, { color: primary }]}>{(c.name || '?')[0].toUpperCase()}</Text>
                    )}
                    <Text numberOfLines={2} style={[s.tileName, { color: c.image ? '#FFFFFF' : text }]}>{c.name}</Text>
                    <Animated.View style={[s.tileCheck, { backgroundColor: primary, opacity: a, transform: [{ scale: a }] }]}>
                        <Ionicons name="checkmark" size={12} color={onPrimary} />
                    </Animated.View>
                </View>
            </Animated.View>
        </Pressable>
    );
}

/* pill: a small photo circle and the name; the selected one fills with the brand colour */
function CatPill({ c, on, onPress }) {
    const { primary, onPrimary, text, soft, surface, border } = useBrand();
    const a = useOn(on, 180);
    const p = useRef(new Animated.Value(1)).current;
    const to = (v) => Animated.spring(p, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)} style={s.pillWrap}>
            <Animated.View style={{ transform: [{ scale: p }] }}>
                <View style={[s.catPill, { backgroundColor: surface, borderColor: border }]}>
                    {/* the brand fill fades in over the plain pill */}
                    <Animated.View pointerEvents="none" style={[s.pillFill, { backgroundColor: primary, borderColor: primary, opacity: a }]} />
                    <View style={[s.pillPic, { backgroundColor: soft }]}>
                        {c.image ? <Image source={{ uri: c.image }} style={s.pillImg} contentFit="cover" />
                            : <Text style={{ fontWeight: '800', color: primary, fontSize: 13 }}>{(c.name || '?')[0].toUpperCase()}</Text>}
                    </View>
                    <Text numberOfLines={1} style={[s.pillName, { color: on ? onPrimary : text }]}>{c.name}</Text>
                </View>
            </Animated.View>
        </Pressable>
    );
}

// The category row. Drawn as circles (the original), photo tiles, or pills, as the shop's settings say.
// loading: the menu has not arrived yet, so show the shape of the row instead of nothing.
export function Cats({ loading = false }) {
    const { primary, onPrimary, background } = useBrand();
    const style = useThemeStore((st) => st.theme.categoryStyle) || 'circles';
    const allChips = useHomeStore((st) => st.categories);
    const vegOnly = useFilterStore((st) => st.active.includes('veg_only'));
    const menu = useMenuStore((st) => st.categories);
    // with VEG on, a category that has no veg dish is not shown at all
    const chips = React.useMemo(() => {
        if (!vegOnly || !menu.length) return allChips;
        const has = new Set(menu.filter((c) => (c.items || []).some((p) => p.isVeg)).map((c) => String(c._id)));
        return allChips.filter((c) => has.has(String(c._id)));
    }, [allChips, menu, vegOnly]);
    const sel = useFilterStore((st) => st.categories);
    const toggle = useFilterStore((st) => st.toggleCategory);
    const clear = useFilterStore((st) => st.clearCategories);
    const any = sel.length > 0;
    const w = useOn(any, 220);   // opacity / slide only: nothing in the row is ever pushed sideways

    if (!chips.length) return loading ? <SkelCats style={style} /> : null;

    const clearW = style === 'circles' ? 84 : style === 'tiles' ? 70 : 52;
    const contentStyle = style === 'pills' ? s.catsPills : s.cats;
    return (
        <View>
            <ScrollView
                horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={[contentStyle, any ? { paddingRight: 16 + clearW } : null]}
                keyboardShouldPersistTaps="handled"
            >
                {chips.map((c, i) => {
                    const id = String(c._id);
                    const on = sel.includes(id);
                    const Item = style === 'tiles' ? CatTile : style === 'pills' ? CatPill : CatItem;
                    return (
                        <FadeIn key={id} index={i} distance={10}>
                            <Item c={c} on={on} onPress={() => toggle(id)} />
                        </FadeIn>
                    );
                })}
            </ScrollView>
            {/* "Clear all" floats at the right edge: it fades in over the row, so no chip ever moves when it appears */}
            <Animated.View
                pointerEvents={any ? 'box-none' : 'none'}
                style={[s.clearFloat, style === 'circles' ? { justifyContent: 'flex-start', paddingTop: 12 } : null, { width: clearW + 28, opacity: w, transform: [{ translateX: w.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}
            >
                <LinearGradient pointerEvents="none" colors={[clearOf(background), background, background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                {style === 'circles' ? (
                    <Pressable onPress={clear} style={s.cat}>
                        <View style={[s.catRing, { borderColor: 'transparent' }]}>
                            <View style={[s.catCircle, { backgroundColor: primary }]}>
                                <Ionicons name="close" size={26} color={onPrimary} />
                            </View>
                        </View>
                        <Text numberOfLines={1} style={[s.catName, { color: primary, fontWeight: '800' }]}>Clear all</Text>
                    </Pressable>
                ) : (
                    <Pressable onPress={clear} hitSlop={6} style={s.clearDot}>
                        <View style={[s.clearCircle, { backgroundColor: primary }]}>
                            <Ionicons name="close" size={20} color={onPrimary} />
                        </View>
                        {style === 'tiles' ? <Text numberOfLines={1} style={[s.catName, { color: primary, fontWeight: '800' }]}>Clear</Text> : null}
                    </Pressable>
                )}
            </Animated.View>
        </View>
    );
}
/* ---------- filter chips row ---------- */
export function Chip({ label, on, onPress, badge, icon }) {
    const { primary, onPrimary, surface, border, text } = useBrand();
    const fg = on ? onPrimary : text;
    return (
        <Pressable onPress={onPress} style={[s.chip, { backgroundColor: on ? primary : surface, borderColor: on ? primary : border }]}>
            {icon ? <Ionicons name={icon} size={14} color={fg} style={{ marginRight: 5 }} /> : null}
            <Text style={[s.chipTxt, { color: fg }]}>{label}</Text>
            {badge ? <View style={[s.chipBadge, { backgroundColor: primary }]}><Text style={[s.cBadgeTxt, { color: onPrimary }]}>{badge}</Text></View> : null}
        </Pressable>
    );
}

export function FiltersRow({ onOpen }) {
    const config = useHomeStore((st) => st.config);
    const f = useFilterStore();
    const n = countActive(f);
    const quick = [];
    if (config.sortOptions.includes('price_low')) {
        quick.push(['Price: low', f.sort === 'price_low', () => f.setSort(f.sort === 'price_low' ? null : 'price_low')]);
    }
    [['bestseller', 'Bestseller'], ['rating_4', 'Rating 4+'], ['offers', 'Offers']].forEach(([id, label]) => {
        if (config.filters.includes(id)) quick.push([label, f.active.includes(id), () => f.toggleFilter(id)]);
    });
    const canOpen = config.filters.length > 0 || config.sortOptions.length > 1;
    if (!canOpen && !quick.length) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fl} keyboardShouldPersistTaps="handled">
            {canOpen ? <Chip icon="options-outline" label="Filters" on={false} badge={n} onPress={onOpen} /> : null}
            {quick.map((q) => <Chip key={q[0]} label={q[0]} on={q[1]} onPress={q[2]} />)}
        </ScrollView>
    );
}

/* ---------- voice search (speech to text) ---------- */
export function useVoice(onDone) {
    const [on, setOn] = useState(false);
    const [txt, setTxt] = useState('');
    const last = useRef('');
    const done = useRef(onDone);
    done.current = onDone;

    useSpeechRecognitionEvent('start', () => { last.current = ''; setTxt(''); setOn(true); });
    useSpeechRecognitionEvent('result', (e) => {
        const t = e.results?.[0]?.transcript || '';
        last.current = t;
        setTxt(t);
    });
    useSpeechRecognitionEvent('error', (e) => {
        setOn(false);
        if (e.error === 'no-speech') showToast("Didn't catch that. Try again.");
        else if (e.error !== 'aborted') showToast("Couldn't hear that. Try again.");
    });
    useSpeechRecognitionEvent('end', () => {
        setOn(false);
        const t = last.current.trim();
        last.current = '';
        if (t) done.current(t);
    });

    const start = useCallback(async () => {
        const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!p.granted) { showToast('Allow the microphone to use voice search'); return; }
        ExpoSpeechRecognitionModule.start({ lang: 'en-IN', interimResults: true, continuous: false });
    }, []);
    const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
    return { on, txt, start, stop };
}

export function VoiceOverlay({ on, txt, onStop }) {
    const { primary, onPrimary, text, muted, background } = useBrand();
    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!on) return undefined;
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]));
        loop.start();
        return () => { loop.stop(); pulse.setValue(0); };
    }, [on]);
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
    return (
        <Modal visible={on} transparent animationType="fade" onRequestClose={onStop} statusBarTranslucent>
            <View style={s.vBack}>
                <View style={[s.vCard, { backgroundColor: background }]}>
                    <Text style={[s.vTitle, { color: text }]}>Listening…</Text>
                    <Text style={[s.vText, { color: txt ? text : muted }]} numberOfLines={3}>{txt || 'Say a dish name'}</Text>
                    <Pressable onPress={onStop} style={s.vMicWrap}>
                        <Animated.View style={[s.vPulse, { backgroundColor: tint(primary), transform: [{ scale }] }]} />
                        <View style={[s.vMic, { backgroundColor: primary }]}>
                            <Ionicons name="mic" size={30} color={onPrimary} />
                        </View>
                    </Pressable>
                    <Text style={[s.vHint, { color: muted }]}>Tap the mic when you're done</Text>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    abs: { position: 'absolute', left: 0, right: 0, top: 0 },
    ph: { flex: 1, height: 20, lineHeight: 20, fontSize: 14, marginLeft: 10 },
    phBox: { flex: 1, height: 20, marginLeft: 10, overflow: 'hidden' },
    phTxt: { height: 20, lineHeight: 20, fontSize: 14 },
    phAbs: { position: 'absolute', left: 0, right: 0, top: 0 },
    vegWrap: { marginLeft: 12 },
    vPill: { width: 72, height: 36, borderRadius: 18, borderWidth: 1.5, justifyContent: 'center' },
    vFill: { position: 'absolute', top: -1.5, left: -1.5, right: -1.5, bottom: -1.5, borderRadius: 18, backgroundColor: '#0F8A3C' },
    vLabel: { position: 'absolute', top: 0, bottom: 0, fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textAlignVertical: 'center', lineHeight: 33 },
    vMarkOn: { alignItems: 'center', justifyContent: 'center' },
    vKnob: { position: 'absolute', top: 3, left: 3, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 2, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    vMark: { width: 14, height: 14, borderWidth: 1.8, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
    vMarkDot: { width: 6, height: 6, borderRadius: 3 },
    cats: { paddingHorizontal: 16, paddingVertical: 12 },
    cat: { width: 78, alignItems: 'center', marginRight: 6 },
    catRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
    catCircle: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    catImg: { width: 62, height: 62 },
    catName: { marginTop: 5, fontSize: 12 },
    catX: { position: 'absolute', top: 0, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    catsPills: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
    tileWrap: { marginRight: 10, paddingTop: 4 },
    tile: { width: 84, height: 100, borderRadius: 18, borderWidth: 2.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' },
    tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 62 },
    tileInitial: { position: 'absolute', top: 18, fontSize: 30, fontWeight: '800', opacity: 0.7 },
    tileName: { fontSize: 12, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6, paddingBottom: 7 },
    tileCheck: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    // sits exactly over a bordered parent's border, so a brand-coloured outline can fade in on top of it
    edge: { position: 'absolute', top: -2.5, left: -2.5, right: -2.5, bottom: -2.5, borderWidth: 2.5 },
    pillFill: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 21, borderWidth: 1 },
    clearFloat: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'flex-end' },
    pillWrap: { marginRight: 8 },
    catPill: { flexDirection: 'row', alignItems: 'center', height: 42, paddingLeft: 5, paddingRight: 14, borderRadius: 21, borderWidth: 1 },
    pillPic: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: 8 },
    pillImg: { width: 32, height: 32 },
    pillName: { fontSize: 13, fontWeight: '700', maxWidth: 120 },
    clearDot: { alignItems: 'center', justifyContent: 'center', paddingRight: 10 },
    clearCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    fl: { paddingHorizontal: 16, paddingVertical: 10 },
    chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 20, marginRight: 8 },
    chipTxt: { fontSize: 13, fontWeight: '700' },
    chipBadge: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, marginLeft: 6, alignItems: 'center', justifyContent: 'center' },
    cBadgeTxt: { fontSize: 10, fontWeight: '800' },
    vBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    vCard: { width: '100%', borderRadius: 24, padding: 24, alignItems: 'center' },
    vTitle: { fontSize: 18, fontWeight: '800' },
    vText: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 12, minHeight: 50 },
    vMicWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    vPulse: { position: 'absolute', width: 84, height: 84, borderRadius: 42 },
    vMic: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
    vHint: { fontSize: 12, marginTop: 8 },
});