// src/components/ui/finder.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Animated, Easing, Modal, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useBrand } from './kit';
import { tint, showToast } from './shop';
import { useHomeStore } from '../../store/useHomeStore';
import { useFilterStore, countActive } from '../../store/useFilterStore';

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
export function VegSwitch({ on, onPress }) {
    const x = useRef(new Animated.Value(on ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(x, { toValue: on ? 1 : 0, duration: 180, useNativeDriver: false }).start();
    }, [on]);
    const bg = x.interpolate({ inputRange: [0, 1], outputRange: ['#C9CCD1', '#0F8A3C'] });
    const left = x.interpolate({ inputRange: [0, 1], outputRange: [2, 20] });
    const mark = on ? '#0F8A3C' : '#8A8F98';
    return (
        <Pressable onPress={onPress} hitSlop={8} style={s.vegWrap}>
            <Text style={[s.vegTxt, { color: on ? '#0F8A3C' : '#6B7078' }]}>VEG</Text>
            <Animated.View style={[s.vTrack, { backgroundColor: bg }]}>
                <Animated.View style={[s.vKnob, { left }]}>
                    <View style={[s.vMark, { borderColor: mark }]}>
                        <View style={[s.vMarkDot, { backgroundColor: mark }]} />
                    </View>
                </Animated.View>
            </Animated.View>
        </Pressable>
    );
}

/* ---------- categories: multi-select with Clear all ---------- */
export function Cats() {
    const { primary, onPrimary, text, soft } = useBrand();
    const chips = useHomeStore((st) => st.categories);
    const sel = useFilterStore((st) => st.categories);
    const toggle = useFilterStore((st) => st.toggleCategory);
    const clear = useFilterStore((st) => st.clearCategories);
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats} keyboardShouldPersistTaps="handled">
            {sel.length ? (
                <Pressable onPress={clear} style={s.cat}>
                    <View style={[s.catRing, { borderColor: 'transparent' }]}>
                        <View style={[s.catCircle, { backgroundColor: primary }]}>
                            <Ionicons name="close" size={26} color={onPrimary} />
                        </View>
                    </View>
                    <Text numberOfLines={1} style={[s.catName, { color: primary, fontWeight: '800' }]}>Clear all</Text>
                </Pressable>
            ) : null}
            {chips.map((c) => {
                const id = String(c._id);
                const on = sel.includes(id);
                return (
                    <Pressable key={id} onPress={() => toggle(id)} style={s.cat}>
                        <View style={[s.catRing, { borderColor: on ? primary : 'transparent' }]}>
                            <View style={[s.catCircle, { backgroundColor: soft }]}>
                                {c.image ? <Image source={{ uri: c.image }} style={s.catImg} contentFit="cover" />
                                    : <Text style={{ fontWeight: '800', color: primary, fontSize: 22 }}>{(c.name || '?')[0].toUpperCase()}</Text>}
                            </View>
                        </View>
                        {on ? <View style={[s.catX, { backgroundColor: primary }]}><Ionicons name="close" size={11} color={onPrimary} /></View> : null}
                        <Text numberOfLines={1} style={[s.catName, { color: on ? primary : text, fontWeight: on ? '800' : '600' }]}>{c.name}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
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
    vegWrap: { alignItems: 'center', marginLeft: 12 },
    vegTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 3 },
    vTrack: { width: 40, height: 22, borderRadius: 11 },
    vKnob: { position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 1 },
    vMark: { width: 11, height: 11, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
    vMarkDot: { width: 5, height: 5, borderRadius: 2.5 },
    cats: { paddingHorizontal: 16, paddingVertical: 12 },
    cat: { width: 78, alignItems: 'center', marginRight: 6 },
    catRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
    catCircle: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    catImg: { width: 62, height: 62 },
    catName: { marginTop: 5, fontSize: 12 },
    catX: { position: 'absolute', top: 0, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
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