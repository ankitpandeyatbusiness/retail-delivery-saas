// A switch whose knob slides smoothly (a soft spring on the UI thread) and moves the moment it is touched, without waiting for the server.
// If the change is refused and `value` comes back unchanged, the knob slides back by itself.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, View, Platform } from 'react-native';
import { useBrand, alpha } from './kit';

const W = 52; const H = 30; const K = 24;
const WEB = Platform.OS === 'web';   // on the website the knob slides with a CSS transition (smooth even while the page is busy)

export default function SlideSwitch({ value, onValueChange, disabled, accessibilityLabel }) {
    const { primary, border, muted } = useBrand();
    const [on, setOn] = useState(!!value);
    const v = useRef(new Animated.Value(value ? 1 : 0)).current;
    useEffect(() => { setOn(!!value); }, [value]);   // the real state arrived (or the change was refused)
    useEffect(() => {
        if (WEB) return;   // the website slides with CSS (below)
        Animated.spring(v, { toValue: on ? 1 : 0, friction: 9, tension: 120, useNativeDriver: true }).start();
    }, [on, v]);
    const press = () => {
        if (disabled) return;
        const next = !on;
        setOn(next);
        // the website: what the switch does is handed on after the knob has slid (changing a setting re-draws the page, which would freeze the slide)
        if (WEB) setTimeout(() => onValueChange?.(next), 220); else onValueChange?.(next);
    };
    if (WEB) {
        return (
            <Pressable onPress={press} disabled={disabled} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={accessibilityLabel} style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}>
                <View style={{ width: W, height: H, borderRadius: H / 2, backgroundColor: border, overflow: 'hidden', justifyContent: 'center' }}>
                    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(primary, 0.55), opacity: on ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '240ms' }} />
                    <View style={{ width: K, height: K, borderRadius: K / 2, backgroundColor: on ? primary : '#F4F4F4', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transform: [{ translateX: on ? W - K - 3 : 3 }], transitionProperty: 'transform, background-color', transitionDuration: '240ms', transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }} />
                </View>
            </Pressable>
        );
    }
    return (
        <Pressable onPress={press} disabled={disabled} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={accessibilityLabel} style={{ opacity: disabled ? 0.45 : 1 }}>
            <Animated.View style={{ width: W, height: H, borderRadius: H / 2, backgroundColor: border, overflow: 'hidden', justifyContent: 'center' }}>
                <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(primary, 0.55), opacity: v }} />
                <Animated.View style={{ width: K, height: K, borderRadius: K / 2, backgroundColor: on ? primary : '#F4F4F4', elevation: 2, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [3, W - K - 3] }) }] }} />
            </Animated.View>
        </Pressable>
    );
}
