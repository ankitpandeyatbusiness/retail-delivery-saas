// src/components/common/motion.jsx
//
// The shared motion language of the customer app. Everything is transform + opacity on the native driver, so it
// runs on the UI thread. The shop's "Animations" setting (full / subtle / off) and the phone's "reduce motion"
// both turn it down: `off` draws everything in its final place at once.
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, AccessibilityInfo, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useBrand, mix, alpha } from './kit';

/* ---------------- how much motion ---------------- */
let reduceMotion = false;
try {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = !!v; }).catch(() => { });
    AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduceMotion = !!v; });
} catch (e) { /* no accessibility info: keep full motion */ }

// 'full' | 'subtle' | 'off'
export function useMotion() {
    const level = useThemeStore((s) => s.theme.motion) || 'full';
    return reduceMotion ? 'off' : level;
}

/* ---------------- entrance: fade up, staggered ---------------- */
// `index` staggers siblings (capped, so a long list never makes anyone wait).
// subtle = a plain fade (no movement); off = already there.
export function FadeIn({ index = 0, children, style, distance = 14 }) {
    const motion = useMotion();
    const v = useRef(new Animated.Value(motion === 'off' ? 1 : 0)).current;
    useEffect(() => {
        if (motion === 'off') return undefined;
        const a = Animated.timing(v, {
            toValue: 1,
            duration: motion === 'subtle' ? 200 : 340,
            delay: motion === 'subtle' ? 0 : Math.min(index, 8) * 45,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        a.start();
        return () => a.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    if (motion === 'off') return <View style={style}>{children}</View>;
    const move = motion === 'subtle' ? 0 : distance;
    return (
        <Animated.View needsOffscreenAlphaCompositing style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [move, 0] }) }] }, style]}>
            {children}
        </Animated.View>
    );
}

/* ---------------- shimmer ---------------- */
// One loop is shared by every skeleton on screen, so the highlight sweeps across them all in step.
let sweep = null;
let users = 0;
let loop = null;
let stopTimer = null;
function useSweep() {
    if (!sweep) sweep = new Animated.Value(0);
    useEffect(() => {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }   // another skeleton took over at once: the sweep goes on, unbroken
        if (users++ === 0 && !loop) {
            sweep.setValue(0);
            loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
            loop.start();
        }
        return () => {
            if (--users === 0) {
                stopTimer = setTimeout(() => { stopTimer = null; if (users === 0 && loop) { loop.stop(); loop = null; } }, 500);
            }
        };
    }, []);
    return sweep;
}

// A placeholder block in the shop's own colours (a tint of its background, not a generic grey) with a light band sweeping over it.
export function Skel({ width = '100%', height = 14, radius = 8, style }) {
    const { background, text, dark } = useBrand();
    const motion = useMotion();
    const v = useSweep();
    // the band can be drawn in the very first frame (a guess from the width asked for), so a skeleton that replaces another one does not blink; the real width follows
    const guess = typeof width === 'number' ? width : (parseFloat(width) || 100) / 100 * Dimensions.get('window').width;
    const [w, setW] = useState(guess);
    const base = mix(background, text, dark ? 0.12 : 0.07);
    const glow = dark ? mix(background, '#FFFFFF', 0.22) : '#FFFFFF';
    const band = w * 0.7;
    return (
        <View
            onLayout={(e) => { const lw = e.nativeEvent.layout.width; setW((old) => (Math.abs(old - lw) < 0.5 ? old : lw)); }}
            style={[{ width, height, borderRadius: radius, backgroundColor: base, overflow: 'hidden' }, style]}
        >
            {w && motion !== 'off' ? (
                <Animated.View
                    pointerEvents="none"
                    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: band, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-band, w] }) }] }}
                >
                    <LinearGradient colors={[alpha(glow, 0), alpha(glow, dark ? 0.9 : 0.75), alpha(glow, 0)]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                </Animated.View>
            ) : null}
        </View>
    );
}

// Skeleton that melts into the real content: shown while `loading`, then the content fades in over it.
export function Reveal({ loading, skeleton, children }) {
    const motion = useMotion();
    const v = useRef(new Animated.Value(loading ? 0 : 1)).current;
    const was = useRef(loading);
    useEffect(() => {
        if (was.current && !loading && motion !== 'off') {
            v.setValue(0);
            Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
        }
        was.current = loading;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);
    if (loading) return skeleton;
    return <Animated.View style={{ opacity: motion === 'off' ? 1 : v }}>{children}</Animated.View>;
}
