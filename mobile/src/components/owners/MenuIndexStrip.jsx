// The A to Z strip on the right edge of the owner menu (only while the menu is sorted A to Z, English only). Slide a finger along it: the list jumps to the
// first screen starting with the letter under the finger, that letter is highlighted and a big bubble names it. The menu fills the store (letters and their
// positions); the page that holds the menu draws this strip over its scroll area and gives it the scroll view.
import React, { useRef, useState } from 'react';
import { View, Text, PanResponder } from 'react-native';
import { create } from 'zustand';
import { useBrand } from '../common/kit';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// letters that have a screen, and where each starts (y inside the scrolled content)
export const useMenuIndex = create((set) => ({
    on: false,
    ys: {},
    base: 0,   // where the sorted list starts inside the scrolled content
    setOn: (on) => set(on ? { on } : { on, ys: {} }),
    setBase: (base) => set((s) => (s.base === base ? s : { base })),
    setY: (letter, y) => set((s) => (s.ys[letter] === y ? s : { ys: { ...s.ys, [letter]: y } })),
}));

export default function MenuIndexStrip({ scrollRef, top = 90, bottom = 24 }) {
    const { primary, onPrimary, muted, text, surface, border } = useBrand();
    const on = useMenuIndex((s) => s.on);
    const ys = useMenuIndex((s) => s.ys);
    const base = useMenuIndex((s) => s.base);
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

    if (!on || !Object.keys(ys).length) return null;
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 0, top, bottom, width: 120 }}>
            {touch ? (
                <View pointerEvents="none" style={{ position: 'absolute', right: 34, top: '40%', width: 64, height: 64, borderRadius: 32, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 8 }}>
                    <Text style={{ color: onPrimary, fontSize: 34, fontWeight: '900' }}>{touch}</Text>
                </View>
            ) : null}
            <View ref={ref} collapsable={false} {...pan.panHandlers} accessibilityLabel="A to Z" style={{ position: 'absolute', right: 2, top: 0, bottom: 0, width: 26, paddingVertical: 4, borderRadius: 13, overflow: 'hidden', backgroundColor: touch ? surface : 'transparent', borderWidth: touch ? 1 : 0, borderColor: border }}>
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
        </View>
    );
}
