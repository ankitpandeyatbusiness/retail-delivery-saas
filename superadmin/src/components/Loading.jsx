// The app's loader: a shimmer, never a spinner. A soft light sweeps over a small rounded bar in the colour it is given, so
// it works inside a button (white on the brand colour), next to a field, or on its own. Whole pages and lists use the
// skeleton shapes in components/owners/shimmer.jsx instead. It takes the same props as the old spinner, so a screen only
// has to import { ActivityIndicator } from here.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export function ActivityIndicator({ color = '#9AA0A6', size, style }) {
    const big = size === 'large' || (typeof size === 'number' && size > 30);
    const w = big ? 72 : 38;
    const h = big ? 12 : 8;
    const x = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [x]);
    return (
        <View style={[{ width: w, height: h, borderRadius: h / 2, overflow: 'hidden', alignSelf: 'center' }, style]} accessibilityRole="progressbar">
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color, opacity: 0.3 }} />
            <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: w * 0.7, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-w * 0.7, w] }) }] }}>
                <LinearGradient colors={['rgba(255,255,255,0)', color, 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
            </Animated.View>
        </View>
    );
}

export default ActivityIndicator;
