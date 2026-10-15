import React, { useEffect, useRef } from 'react';
import { Animated, Easing, LayoutAnimation } from 'react-native';

/*
 * Small motion helpers. Everything is transform + opacity on the native driver (UI thread, no JS per frame).
 */

// Content fades up into place. `index` staggers siblings (capped, so a long list never waits).
export function FadeIn({ index = 0, children, style, distance = 14 }) {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const a = Animated.timing(v, { toValue: 1, duration: 320, delay: Math.min(index, 8) * 45, easing: Easing.out(Easing.cubic), useNativeDriver: true });
        a.start();
        return () => a.stop();
    }, [v, index]);
    return (
        <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }, style]}>
            {children}
        </Animated.View>
    );
}

// Rows of a long list: only the first screenful animates, so scrolling back never replays it.
export function FadeInRow({ index, children }) {
    return index < 10 ? <FadeIn index={index} distance={10}>{children}</FadeIn> : children;
}

// One loop shared by every skeleton bar on screen, so the highlight sweeps across them in sync.
let shared = null;
let users = 0;
let loop = null;
export function useShimmer() {
    if (!shared) shared = new Animated.Value(0);
    useEffect(() => {
        if (users++ === 0) {
            shared.setValue(0);
            loop = Animated.loop(Animated.timing(shared, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
            loop.start();
        }
        return () => {
            if (--users === 0 && loop) { loop.stop(); loop = null; }
        };
    }, []);
    return shared;
}

// call right before a state change that adds or removes rows: the neighbours glide instead of jumping
export function animateNext() {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
