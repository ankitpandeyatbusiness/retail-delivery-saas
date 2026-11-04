import React from 'react';
import { Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

// Swipe a row left or right to dismiss it: it slides away, fades, the gap closes smoothly, then onDismiss() runs.
// A short or slow swipe springs back. Up and down still scroll the list (the swipe only starts after a sideways move).
// Put the row's bottom spacing INSIDE children (not as a margin) so the gap closes with it.
const W = Dimensions.get('window').width;
const FAR = 110;          // how far (px) a slow swipe must go
const FAST = 900;         // or how quick (px/s) a flick must be

export default function SwipeAway({ children, onDismiss, disabled }) {
    const x = useSharedValue(0);
    const h = useSharedValue(0);
    const closing = useSharedValue(0);   // 0 = normal, 1 = the gap is closing
    const gap = useSharedValue(1);

    const pan = Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onUpdate((e) => { x.value = e.translationX; })
        .onEnd((e) => {
            const far = Math.abs(e.translationX) > FAR || Math.abs(e.velocityX) > FAST;
            if (!far) { x.value = withSpring(0, { damping: 18, stiffness: 220 }); return; }
            const dir = (e.translationX || e.velocityX) > 0 ? 1 : -1;
            x.value = withTiming(dir * W, { duration: 180, easing: Easing.out(Easing.quad) }, () => {
                closing.value = 1;
                gap.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }, (done) => { if (done) runOnJS(onDismiss)(); });
            });
        });

    const box = useAnimatedStyle(() => (closing.value ? { height: h.value * gap.value, overflow: 'hidden' } : {}));
    const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: 1 - Math.min(Math.abs(x.value) / W, 1) * 0.85 }));

    return (
        <Animated.View style={box}>
            <GestureDetector gesture={pan}>
                <Animated.View style={slide} onLayout={(e) => { if (!closing.value) h.value = e.nativeEvent.layout.height; }}>{children}</Animated.View>
            </GestureDetector>
        </Animated.View>
    );
}
