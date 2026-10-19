// Pull a bottom sheet down to close it, the way the big apps do. The whole sheet can be pulled, not just its handle:
//  - a sheet with nothing to scroll follows the finger from anywhere on it;
//  - a sheet with a list: a swipe up or down scrolls the list as usual. Only when the list is already at its top does a
//    swipe DOWN pull the sheet instead (lift the finger and swipe again once the list has reached the top);
//  - sideways swipes (a row of chips, a slider) are never taken.
// Past a third of its height, or a quick flick, the sheet closes through onClose; let go earlier and it springs back.
// The position lives on the UI thread, so it follows the finger smoothly.
//
//   <DragDown visible onClose>{(scroll) => ( ...the sheet, with  <ScrollView {...scroll}>  on its list... )}</DragDown>
//   (a sheet with no list can pass plain children)
import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import Reanimated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

const SPRING = { damping: 22, stiffness: 260 };

// The pull gesture. ty: how far down the sheet is (shared value); h: its height. Returns the gesture and the props that
// tell it how far the sheet's own list is scrolled (spread them on the list: a ScrollView, FlatList, KeyboardScroll).
export function useSheetPan({ ty, h, onClose, stillOpen, onCloseStart }) {
    // The sheet has slid out under the finger; now the screen is told. If the screen refuses to close it, the sheet comes
    // back instead of staying off screen (the wait is long enough for a slow screen to finish its own update).
    const closeNow = () => { onClose(); if (stillOpen) setTimeout(() => { if (stillOpen.current) ty.value = withSpring(0, SPRING); }, 400); };
    const scrollY = useSharedValue(0);
    const x0 = useSharedValue(0);
    const y0 = useSharedValue(0);
    const start = useSharedValue(0);
    const on = useSharedValue(false);
    const gesture = useMemo(() => Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => { 'worklet'; const t = e.changedTouches[0]; x0.value = t.absoluteX; y0.value = t.absoluteY; on.value = false; })
        .onTouchesMove((e, m) => {
            'worklet';
            if (on.value) return;
            const t = e.changedTouches[0];
            const dx = t.absoluteX - x0.value;
            const dy = t.absoluteY - y0.value;
            if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { m.fail(); return; }   // sideways: not ours
            if (dy < -8) { m.fail(); return; }                                              // upward: the list scrolls
            if (dy > 8) { if (scrollY.value <= 1) { on.value = true; m.activate(); } else m.fail(); }   // down: ours only at the top
        })
        .onStart(() => { 'worklet'; cancelAnimation(ty); start.value = ty.value; })
        .onUpdate((e) => { 'worklet'; ty.value = Math.max(0, start.value + e.translationY); })
        .onEnd((e) => {
            'worklet';
            if (ty.value > h.value / 3 || e.velocityY > 900) {
                // carry on down with the finger's momentum, and only then close: no stop-and-go at the end
                if (onCloseStart) runOnJS(onCloseStart)();   // the sheet starts leaving: the dim background fades and touches go through already
                ty.value = withTiming(h.value + 60, { duration: 170 }, (done) => { if (done) runOnJS(closeNow)(); });
            } else ty.value = withSpring(0, SPRING);
        }), [ty, h, onClose, stillOpen, onCloseStart, scrollY, x0, y0, start, on]);   // eslint-disable-line react-hooks/exhaustive-deps
    const scrollProps = useMemo(() => ({
        onScroll: (e) => { scrollY.value = e.nativeEvent.contentOffset.y; },
        scrollEventThrottle: 16,
        bounces: false,
        overScrollMode: 'never',
    }), [scrollY]);
    return { gesture, scrollProps, scrollY };
}

export function DragDown({ onClose, onCloseStart, visible = true, children }) {
    const ty = useSharedValue(0);
    const h = useSharedValue(400);
    const stillOpen = useRef(visible);
    stillOpen.current = visible;
    const { gesture, scrollProps, scrollY } = useSheetPan({ ty, h, onClose, stillOpen, onCloseStart });
    useEffect(() => { if (visible) { cancelAnimation(ty); ty.value = 0; scrollY.value = 0; } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const move = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
    return (
        <GestureHandlerRootView style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }}>
                <GestureDetector gesture={gesture}>
                    <Reanimated.View style={move} onLayout={(e) => { h.value = e.nativeEvent.layout.height; }}>{typeof children === 'function' ? children(scrollProps) : children}</Reanimated.View>
            </GestureDetector>
        </GestureHandlerRootView>
    );
}

// Kept for the sheets that mark their handle: the whole sheet is pullable now, so this is only a wrapper.
export function Grip({ children, style }) {
    return <View style={style}>{children}</View>;
}
