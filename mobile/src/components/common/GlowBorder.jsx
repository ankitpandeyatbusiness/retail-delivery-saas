// A blinking, glowing gradient rim around a card, to pull the eye to it while `active` (e.g. new orders waiting).
// The children keep their own background; only the rim and a soft halo around them pulse.
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useBrand } from './kit';

// The glow must be seen on ANY shop's background. A colour that is too close to the page colour (a red glow on a red theme) is swapped
// for the most visible one of a few alert colours.
const rgb = (h) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const x = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const lum = (h) => {
    const c = rgb(h);
    if (!c) return null;
    const f = (v) => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    if (x == null || y == null) return 21;   // not a plain colour: leave it alone
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const ALERTS = ['#FF3B30', '#FF9500', '#FFD60A', '#00B8D9', '#7C4DFF', '#FF2D95', '#00E676', '#FFFFFF', '#000000'];
export function visibleColors(colors, bg) {
    const best = () => ALERTS.find((c) => ratio(c, bg) >= 2.6) || ALERTS.reduce((a, c) => (ratio(c, bg) > ratio(a, bg) ? c : a), ALERTS[0]);
    return colors.map((c) => (ratio(c, bg) >= 2.2 ? c : best()));
}

export default function GlowBorder({ active, colors: wanted = ['#FF3B30', '#FF9500', '#FFD60A'], radius = 16, width = 2.5, style, children }) {
    const { background } = useBrand();
    const colors = visibleColors(wanted, background);
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
