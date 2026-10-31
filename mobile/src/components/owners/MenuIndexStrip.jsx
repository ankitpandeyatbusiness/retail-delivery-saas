// The A to Z strip on the right edge of the owner menu (only while the menu is sorted A to Z, English only). Slide a finger along it: the list jumps to the
// first screen starting with the letter under the finger, that letter is highlighted and a big bubble names it. The menu fills the store (letters and their
// positions); the page that holds the menu draws this strip over its scroll area and gives it the scroll view.
import React, { useRef, useState } from 'react';
import { View, Text, PanResponder, Animated, Easing } from 'react-native';
import { create } from 'zustand';
import { useBrand } from '../common/kit';
import { tr } from '../../i18n';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// letters that have a screen, and where each starts (y inside the scrolled content)
export const useMenuIndex = create((set) => ({
    on: false,
    ys: {},
    base: 0,   // where the sorted list starts inside the scrolled content
    scrollY: 0,   // how far the menu is scrolled: the strip starts where the list starts, never over the switches and the search box above it
    setScroll: (scrollY) => set((s) => (s.scrollY === scrollY ? s : { scrollY })),
    setOn: (on) => set(on ? { on } : { on, ys: {} }),
    setBase: (base) => set((s) => (s.base === base ? s : { base })),
    setY: (letter, y) => set((s) => (s.ys[letter] === y ? s : { ys: { ...s.ys, [letter]: y } })),
}));

export default function MenuIndexStrip({ scrollRef, top = 90, bottom = 24, pad = 0 }) {
    const { primary, onPrimary, muted, text, surface, border } = useBrand();
    const on = useMenuIndex((s) => s.on);
    const ys = useMenuIndex((s) => s.ys);
    const base = useMenuIndex((s) => s.base);
    const scrollY = useMenuIndex((s) => s.scrollY);
    const [touch, setTouch] = useState('');   // the letter under the finger ('' = not touching)
    const box = useRef({ y: 0, h: 1 });
    const ref = useRef(null);
    const live = useRef({});
    live.current = { ys, base };

    const letterAt = (pageY) => {
        const { y, h } = box.current;
        const i = Math.max(0, Math.min(LETTERS.length - 1, Math.floor(((pageY - y) / h) * LETTERS.length)));
        const have = Object.keys(live.current.ys);
        if (!have.length) return '';
        if (live.current.ys[LETTERS[i]] !== undefined) return LETTERS[i];
        for (let d = 1; d < LETTERS.length; d += 1) {   // an empty letter: the nearest one that has screens
            if (live.current.ys[LETTERS[i + d]] !== undefined) return LETTERS[i + d];
            if (live.current.ys[LETTERS[i - d]] !== undefined) return LETTERS[i - d];
        }
        return '';
    };
    const jump = (pageY) => {
        const l = letterAt(pageY);
        if (!l) return;
        setTouch(l);
        scrollRef?.current?.scrollTo?.({ y: Math.max(0, live.current.base + live.current.ys[l] - 6), animated: false });
    };
    const pan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => { ref.current?.measureInWindow?.((x, y, w, h) => { box.current = { y, h: h || 1 }; jump(e.nativeEvent.pageY); }); },
        onPanResponderMove: (e) => jump(e.nativeEvent.pageY),
        onPanResponderRelease: () => setTouch(''),
        onPanResponderTerminate: () => setTouch(''),
    })).current;

    const shown = on && Object.keys(ys).length > 0;
    const fade = useRef(new Animated.Value(0)).current;   // the letters fade in with the list instead of popping up
    React.useEffect(() => { if (shown) Animated.timing(fade, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); else fade.setValue(0); }, [shown, fade]);
    if (!shown) return null;
    return (
        <Animated.View pointerEvents="box-none" style={{ opacity: fade, position: 'absolute', right: 0, top: Math.max(top, top + base + pad - scrollY), bottom, width: 120 }}>
            {touch ? (
                <View pointerEvents="none" style={{ position: 'absolute', right: 34, top: '40%', width: 64, height: 64, borderRadius: 32, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 8 }}>
                    <Text style={{ color: onPrimary, fontSize: 34, fontWeight: '900' }}>{touch}</Text>
                </View>
            ) : null}
            <View ref={ref} collapsable={false} {...pan.panHandlers} accessibilityLabel={tr('A to Z')} style={{ position: 'absolute', right: 2, top: 0, bottom: 0, width: 26, paddingVertical: 4, borderRadius: 13, overflow: 'hidden', backgroundColor: touch ? surface : 'transparent', borderWidth: touch ? 1 : 0, borderColor: border }}>
                {LETTERS.map((l) => {
                    const has = ys[l] !== undefined;
                    const lit = touch === l;
                    return (
                        <View key={l} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{ width: 20, height: 20, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? primary : 'transparent' }}>
                                <Text style={{ color: lit ? onPrimary : has ? text : muted, opacity: has ? 1 : 0.35, fontSize: 10.5, fontWeight: '900' }}>{l}</Text>
                            </View>
                        </View>
                    );
                })}
            </View>
        </Animated.View>
    );
}
