// A blinking, glowing gradient rim around a card, to pull the eye to it while `active` (e.g. new orders waiting).
// The children keep their own background; only the rim and a soft halo around them pulse.
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function GlowBorder({ active, colors = ['#FF3B30', '#FF9500', '#FFD60A'], radius = 16, width = 2.5, style, children }) {
    const v = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        if (!active) { v.setValue(1); return undefined; }
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(v, { toValue: 0.2, duration: 650, useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [active, v]);
    if (!active) return <View style={style}>{children}</View>;
    const layer = (inset, r, opacity) => ({ position: 'absolute', left: -inset, right: -inset, top: -inset, bottom: -inset, borderRadius: r, opacity });
    return (
        <View style={style}>
            <Animated.View pointerEvents="none" style={layer(width + 7, radius + width + 7, Animated.multiply(v, 0.28))}>
                <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: radius + width + 7 }} />
            </Animated.View>
            <Animated.View pointerEvents="none" style={layer(width, radius + width, v)}>
                <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: radius + width }} />
            </Animated.View>
            {children}
        </View>
    );
}
