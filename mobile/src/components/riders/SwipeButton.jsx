// "Swipe to confirm", like Zomato and Blinkit use for a step that must not be pressed by accident: drag the round handle to the end.
// Let go before the end and it springs back. At the end the step is done, the handle waits there while it works (busy) and comes
// back when it is finished. The handle and the fill follow the finger on the UI thread, so it stays smooth.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useBrand, alpha } from '../common/kit';
import { LineShimmer } from '../owners/shimmer';
import { buzz } from '../../utils/common/sfx';

const H = 60;       // height of the bar
const KNOB = 52;    // the handle
const PAD = 4;      // room around the handle

// one arrow of the "swipe this way" hint: the three light up one after the other, left to right, over and over
function Arrow({ i, t, x, maxSV, color }) {
    const st = useAnimatedStyle(() => ({
        opacity: interpolate(t.value, [i / 4, (i + 1) / 4, (i + 2) / 4], [0.18, 1, 0.18], Extrapolation.CLAMP)
            * interpolate(x.value, [0, maxSV.value * 0.35], [1, 0], Extrapolation.CLAMP),   // they go away once he is swiping
    }));
    return <Reanimated.View style={st}><Ionicons name="chevron-forward" size={22} color={color} style={{ marginLeft: i ? -9 : 0 }} /></Reanimated.View>;
}

export default function SwipeButton({ label, icon = 'location', onConfirm, busy, disabled, style }) {
    const { primary, onPrimary, radius } = useBrand();
    const [w, setW] = useState(0);
    const x = useSharedValue(0);
    const max = Math.max(1, w - KNOB - PAD * 2);
    const maxSV = useSharedValue(1);
    useEffect(() => { maxSV.value = max; }, [max, maxSV]);

    // the hint: the handle breathes (with a ring around it) and the arrows run towards the end, until he starts to swipe
    const t = useSharedValue(0);
    const beat = useSharedValue(0);
    useEffect(() => {
        t.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
        beat.value = withRepeat(withSequence(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 750, easing: Easing.inOut(Easing.quad) })), -1, false);
    }, [t, beat]);

    const fire = useCallback(() => { buzz([0, 40, 50, 60]); if (onConfirm) onConfirm(); }, [onConfirm]);
    // while the step works the handle waits at the end; when it is over (or failed) it comes back
    useEffect(() => { if (!busy) x.value = withSpring(0, { damping: 18, stiffness: 220 }); }, [busy, x]);

    const pan = Gesture.Pan()
        .enabled(!disabled && !busy)
        .activeOffsetX([-6, 6])
        .failOffsetY([-14, 14])
        .onUpdate((e) => { 'worklet'; x.value = Math.min(maxSV.value, Math.max(0, e.translationX)); })
        .onEnd((e) => {
            'worklet';
            if (x.value > maxSV.value * 0.82 || (e.velocityX > 900 && x.value > maxSV.value * 0.4)) {
                x.value = withTiming(maxSV.value, { duration: 110 });
                runOnJS(fire)();
            } else {
                x.value = withSpring(0, { damping: 18, stiffness: 240 });
            }
        });

    const rest = (v) => { 'worklet'; return 1 - Math.min(1, v / (maxSV.value * 0.3)); };   // 1 while the handle is at rest, 0 once it is dragged
    const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scale: 1 + 0.08 * beat.value * rest(x.value) }] }));
    const ring = useAnimatedStyle(() => ({
        opacity: (0.55 - 0.45 * beat.value) * rest(x.value),
        transform: [{ translateX: x.value }, { scale: 1 + 0.28 * beat.value }],
    }));
    const fill = useAnimatedStyle(() => ({ width: x.value + KNOB + PAD * 2 }));
    const text = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, maxSV.value * 0.55], [1, 0], Extrapolation.CLAMP) }));

    return (
        <GestureDetector gesture={pan}>
            <View
                onLayout={(e) => setW(e.nativeEvent.layout.width)}
                accessible accessibilityRole="button" accessibilityLabel={label} accessibilityActions={[{ name: 'activate' }]}
                onAccessibilityAction={() => { if (!disabled && !busy) fire(); }}
                style={[{ height: H, borderRadius: Math.min(radius || 16, H / 2) + 14, backgroundColor: alpha(primary, 0.14), borderWidth: 1, borderColor: alpha(primary, 0.35), justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, style]}
            >
                <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: alpha(primary, 0.28), borderRadius: H }, fill]} />
                {/* the ring that pulses around the handle */}
                <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: PAD, top: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: primary }, ring]} />
                {/* the arrows that run towards the end */}
                {busy ? null : (
                    <View pointerEvents="none" style={{ position: 'absolute', right: 14, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' }}>
                        {[0, 1, 2].map((i) => <Arrow key={i} i={i} t={t} x={x} maxSV={maxSV} color={primary} />)}
                    </View>
                )}
                <Reanimated.View pointerEvents="none" style={[{ alignItems: 'center', justifyContent: 'center', paddingLeft: KNOB + PAD * 2, paddingRight: 64 }, text]}>
                    {busy ? <LineShimmer width={90} height={12} /> : <Text numberOfLines={1} style={{ color: primary, fontWeight: '900', fontSize: 15, letterSpacing: 0.3 }}>{label}</Text>}
                </Reanimated.View>
                <Reanimated.View
                    pointerEvents="none"
                    style={[{ position: 'absolute', left: PAD, top: PAD, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 3 }, knob]}
                >
                    <Ionicons name={busy ? icon : 'chevron-forward'} size={24} color={onPrimary} />
                </Reanimated.View>
            </View>
        </GestureDetector>
    );
}
