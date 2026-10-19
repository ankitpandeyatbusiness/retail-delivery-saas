// A ScrollView for screens with text boxes. When the keyboard opens, the box being typed in is slid up to sit just above
// the keyboard (never off the screen), and the page can still be scrolled freely to look at the rest.
//
//   <KeyboardScroll contentContainerStyle={...}>...</KeyboardScroll>      (same props and ref as ScrollView)
//
// Why: on Android the app draws behind the system bars, so the phone does not push the page up for the keyboard and the
// keyboard covers the box. This adds room under the content equal to the keyboard (so even the last box can be lifted), and
// scrolls by exactly as much as is needed. It follows the cursor from one box to the next. iOS already does this itself.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';

const GAP = 20;   // space kept between the box and the keyboard

const KeyboardScroll = forwardRef(function KeyboardScroll({ children, onScroll, scrollEventThrottle, keyboardShouldPersistTaps = 'handled', ...rest }, ref) {
    const sv = useRef(null);
    const offset = useRef(0);
    const kbTop = useRef(0);          // where the keyboard starts on the screen (y); 0 = no keyboard
    const boxBottom = useRef(Infinity);   // where this list ends on the screen (y). Smaller than kbTop when the phone already made the page shorter for the keyboard
    const lastInput = useRef(null);
    const { height: winH } = useWindowDimensions();
    const [kb, setKb] = useState(0);
    useImperativeHandle(ref, () => sv.current);

    // slide the focused box up so its bottom edge is above the keyboard
    const reveal = useCallback(() => {
        const input = TextInput.State?.currentlyFocusedInput?.();
        if (!input || !sv.current || !kbTop.current) return;
        lastInput.current = input;
        input.measureInWindow((x, y, w, h) => {
            if (!Number.isFinite(y)) return;
            const edge = Math.min(kbTop.current, boxBottom.current);   // the lowest line that can be seen: the keyboard, or the end of this list
            const over = y + h + GAP - edge;   // how far the box reaches below it
            if (over > 0) sv.current?.scrollTo({ y: Math.max(0, offset.current + over), animated: true });
        });
    }, []);

    useEffect(() => {
        if (Platform.OS === 'ios') return undefined;   // iOS lifts the page itself (automaticallyAdjustKeyboardInsets)
        const show = Keyboard.addListener('keyboardDidShow', (e) => {
            const h = e?.endCoordinates?.height || 0;
            kbTop.current = e?.endCoordinates?.screenY || (winH - h);
            // Room is added under the content only for the part of THIS list the keyboard really covers. A list that ends above the
            // keyboard (a button bar under it, or a phone that already shrank the page) needs less, or none: no big empty gap.
            const settle = () => {
                try {
                    sv.current.measureInWindow((x, y, w, ht) => {
                        if (!kbTop.current) return;
                        if (Number.isFinite(y) && Number.isFinite(ht)) { boxBottom.current = y + ht; setKb(Math.max(1, Math.round(y + ht - kbTop.current))); } else setKb(h);
                        setTimeout(reveal, 50);   // after the spacer under the content has grown
                    });
                } catch (err) { setKb(h); setTimeout(reveal, 50); }
            };
            // again a little later: the page may be moved or resized after the keyboard shows (a bar lifted above it), and the box is lifted again
            settle();
            setTimeout(settle, 350);
            setTimeout(settle, 800);
        });
        const hide = Keyboard.addListener('keyboardDidHide', () => { kbTop.current = 0; boxBottom.current = Infinity; lastInput.current = null; setKb(0); });
        return () => { show.remove(); hide.remove(); };
    }, [winH, reveal]);

    // the cursor moved to another box while the keyboard stays open
    useEffect(() => {
        if (!kb) return undefined;
        const t = setInterval(() => {
            const cur = TextInput.State?.currentlyFocusedInput?.();
            if (cur && cur !== lastInput.current) reveal();
        }, 250);
        return () => clearInterval(t);
    }, [kb, reveal]);

    return (
        <ScrollView
            ref={sv}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            automaticallyAdjustKeyboardInsets
            scrollEventThrottle={scrollEventThrottle || 16}
            onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y; if (onScroll) onScroll(e); }}
            {...rest}
        >
            {children}
            {kb > 0 ? <View style={{ height: kb }} /> : null}
        </ScrollView>
    );
});

// For a page with a bar fixed under its list (a Save / Send button): the whole page is lifted above the keyboard, bar included,
// when the phone has not already done it. Put `ref` on the View that holds the list and the bar, and `lift` as its paddingBottom.
export function useKeyboardLift() {
    const ref = useRef(null);
    const [lift, setLift] = useState(0);
    useEffect(() => {
        if (Platform.OS === 'ios') return undefined;
        const show = Keyboard.addListener('keyboardDidShow', (e) => {
            const top = e?.endCoordinates?.screenY || 0;
            const measure = () => {
                try {
                    ref.current?.measureInWindow?.((x, y, w, h) => {
                        if (top && Number.isFinite(y) && Number.isFinite(h)) setLift(Math.max(0, Math.round(y + h - top)));   // how far the keyboard reaches into this page
                    });
                } catch (err) { /* the page stays as it is */ }
            };
            setTimeout(measure, 60);
            setTimeout(measure, 400);
        });
        const hide = Keyboard.addListener('keyboardDidHide', () => setLift(0));
        return () => { show.remove(); hide.remove(); };
    }, []);
    return [ref, lift];
}

export default KeyboardScroll;
