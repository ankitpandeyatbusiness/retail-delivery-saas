// "The other person is typing": a small bubble on the left with three dots that bounce one after the other, under the last message (like WhatsApp).
//   <TypingBubble />
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useBrand } from './kit';

function Dot({ delay, color }) {
    const v = useSharedValue(0);
    useEffect(() => {
        // up, down, a short rest, and again, for ever; each dot starts a little after the one before
        v.value = withDelay(delay, withRepeat(withSequence(
            withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }),
            withTiming(0, { duration: 330 }),
        ), -1, false));
        return () => cancelAnimation(v);
    }, [delay, v]);
    const style = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * v.value, transform: [{ translateY: -4 * v.value }] }));
    return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 2.5, backgroundColor: color }, style]} />;
}

export default function TypingBubble() {
    const { surface, border, muted } = useBrand();
    return (
        <View style={{ alignSelf: 'flex-start', marginBottom: 6 }} accessibilityLabel="typing" accessibilityRole="text">
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: surface, borderWidth: 1, borderColor: border, borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 13, paddingVertical: 14 }}>
                <Dot delay={0} color={muted} />
                <Dot delay={160} color={muted} />
                <Dot delay={320} color={muted} />
            </View>
        </View>
    );
}
