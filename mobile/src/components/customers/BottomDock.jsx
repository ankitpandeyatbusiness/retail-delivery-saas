// A radial (pie) menu at the bottom right instead of a pile of cards. With two or more of the cards on screen (cart, dine in table, reserved table, order or
// tracking), their cards step aside and this round button stays, with the icons of what is there on it. Touch and hold it: a quarter circle opens to the
// to the left and up, a ring split into four wedges with only their icons (Dine in, Track, Table QR, Cart). Slide onto a wedge that has a screen behind it:
// it lights up. Let go on it and that screen opens; let go anywhere else and nothing opens. A wedge with nothing behind it is dimmed with a lock.
// A quick tap opens nothing: it only shows a hint. The button itself is one glossy icon, a tiny copy of the fan (a quarter circle of four wedges), whatever cards there are.
// Drawn from plain views (many thin rotated bars), so it needs no extra package.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, PanResponder, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { useDock, dockList } from '../../store/customers/useDock';
import { tr } from '../../i18n';

const TAB_H = 62;
const DISC = 60;
const R1 = 64;       // inner ring
const R2 = 188;      // outer ring
const SPAN = 22.5;   // degrees of one wedge: four of them make the quarter circle
const GAP = 1.6;     // degrees left empty between wedges (the visible border)
const STEP = 1.5;    // degrees between the bars that make a wedge
const LINE = 2;

// the four wedges, from straight up to straight left
const WEDGES = [
    { key: 'table', icon: 'restaurant', label: 'Dine in' },
    { key: 'track', icon: 'bicycle', label: 'Track' },
    { key: 'booking', icon: 'qr-code', label: 'Table QR' },
    { key: 'cart', icon: 'bag-handle', label: 'Cart' },
];

// one wedge: thin bars along the radius, turned a little each, all one colour
function Wedge({ index, fill, line }) {
    const a0 = -90 - index * SPAN - GAP / 2;               // where it starts (degrees, 0 = right, -90 = up)
    const a1 = -90 - (index + 1) * SPAN + GAP / 2;         // where it ends
    const bars = [];
    const n = Math.floor((a0 - a1) / STEP);
    const thick = (2 * Math.PI * R2 / 360) * STEP + 1.5;   // the bar is as thick as the gap it has to fill at the outer ring
    for (let j = 0; j <= n; j += 1) {
        const a = a0 - j * STEP;
        bars.push(
            <View key={j} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: [{ rotate: `${a}deg` }] }}>
                <View style={{ position: 'absolute', left: R1, top: -thick / 2, width: R2 - R1, height: thick, backgroundColor: fill, borderColor: line, borderLeftWidth: LINE, borderRightWidth: LINE, borderBottomWidth: j === 0 ? LINE : 0, borderTopWidth: j === n ? LINE : 0 }} />
            </View>,
        );
    }
    return <>{bars}</>;
}

// The icon on the button: the fan in miniature, a quarter circle of four wedges with its corner at the bottom right (drawn the same way as the real fan)
function MiniFan({ color }) {
    const SIZE = 25; const IN = 7; const OUT = 25; const MSTEP = 4; const MGAP = 4;
    const bars = [];
    for (let i = 0; i < 4; i += 1) {
        const a0 = -90 - i * SPAN - MGAP / 2;
        const a1 = -90 - (i + 1) * SPAN + MGAP / 2;
        const n = Math.floor((a0 - a1) / MSTEP);
        for (let j = 0; j <= n; j += 1) {
            bars.push(
                <View key={`${i}-${j}`} style={{ position: 'absolute', left: SIZE, top: SIZE, width: 0, height: 0, transform: [{ rotate: `${a0 - j * MSTEP}deg` }] }}>
                    <View style={{ position: 'absolute', left: IN, top: -1.9, width: OUT - IN, height: 3.8, backgroundColor: color, opacity: i % 2 ? 0.7 : 1 }} />
                </View>,
            );
        }
    }
    return <View style={{ width: SIZE, height: SIZE }}>{bars}</View>;
}

export default function BottomDock({ navRef }) {
    const items = useDock((s) => s.items);
    const list = dockList(items);
    const insets = useSafeAreaInsets();
    const { primary, primaryLight, primaryDark, onPrimary, surface, text, muted, border } = useBrand();
    const liveHint = useRef(null);   // declared before it is used below (it was after: the screen crashed as it drew)
    const [hint, setHint] = useState(false);
    const hintFade = useRef(new Animated.Value(0)).current;
    const press = useRef(new Animated.Value(1)).current;   // the button sinks a little while it is held
    const hintTimer = useRef(null);
    const showHint = () => {
        clearTimeout(hintTimer.current);
        setHint(true);
        Animated.timing(hintFade, { toValue: 1, duration: 140, useNativeDriver: true }).start();
        hintTimer.current = setTimeout(() => Animated.timing(hintFade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setHint(false)), 1700);
    };
    liveHint.current = showHint;
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(-1);
    const anchor = useRef(null);
    const centre = useRef({ x: 0, y: 0 });
    const timer = useRef(null);
    const fade = useRef(new Animated.Value(0)).current;

    // what each wedge opens now (null = nothing behind it: locked)
    const target = (k) => (k === 'track' ? (items.track || items.order) : items[k]) || null;
    const live = useRef({});
    const isOpen = useRef(false);   // its own ref: "live" is made again on every draw, which wiped the open flag and stopped the sliding
    live.current = { list, target, items };

    const go = (it) => { if (it && navRef?.isReady?.()) navRef.navigate(it.route, it.params); };
    const wedgeAt = (x, y) => {
        const dx = x - centre.current.x; const dy = y - centre.current.y;
        const r = Math.hypot(dx, dy);
        if (r < R1 * 0.7 || r > R2 * 1.25) return -1;
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;   // -180..180
        const t = (-90 - (deg > 0 ? deg - 360 : deg)) / SPAN;   // 0 at straight up, 4 at straight left
        if (t < -0.25 || t > 4.25) return -1;
        const i = Math.max(0, Math.min(3, Math.floor(t)));
        return live.current.target(WEDGES[i].key) ? i : -1;   // a locked wedge cannot be chosen
    };
    const close = () => { clearTimeout(timer.current); isOpen.current = false; setOpen(false); setHover(-1); };

    const pan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
            Animated.spring(press, { toValue: 0.92, friction: 7, tension: 200, useNativeDriver: true }).start();
            anchor.current?.measureInWindow?.((x, y, w, h) => { centre.current = { x: x + w / 2, y: y + h / 2 }; });
            timer.current = setTimeout(() => { isOpen.current = true; setOpen(true); }, 180);
        },
        onPanResponderMove: (_, g) => { if (isOpen.current) setHover(wedgeAt(g.moveX, g.moveY)); },
        onPanResponderRelease: (_, g) => {
            const l = live.current;
            Animated.spring(press, { toValue: 1, friction: 6, tension: 200, useNativeDriver: true }).start();
            if (isOpen.current) { const i = wedgeAt(g.moveX, g.moveY); close(); if (i >= 0) go(l.target(WEDGES[i].key)); return; }   // let go on a lit wedge opens it; anywhere else, nothing
            close();
            liveHint.current?.();   // a quick tap opens nothing: it says how it works
        },
        onPanResponderTerminate: () => { Animated.spring(press, { toValue: 1, friction: 6, tension: 200, useNativeDriver: true }).start(); close(); },
    })).current;

    useEffect(() => { Animated.timing(fade, { toValue: open ? 1 : 0, duration: 170, useNativeDriver: true }).start(); }, [open, fade]);
    useEffect(() => { if (list.length < 2) close(); }, [list.length]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (list.length < 2) return null;

    const bottom = insets.bottom + TAB_H + 18;
    const RM = (R1 + R2) / 2;
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: fade }} />
            {open ? (
                <Animated.View pointerEvents="none" style={{ position: 'absolute', right: 14 + DISC / 2, bottom: bottom + DISC / 2, width: 0, height: 0, opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
                    {WEDGES.map((w, i) => {
                        const there = !!target(w.key);
                        const lit = hover === i;
                        return <Wedge key={w.key} index={i} fill={lit ? primary : there ? surface : alpha(border, 0.55)} line={lit ? primary : border} />;
                    })}
                    {WEDGES.map((w, i) => {
                        const there = !!target(w.key);
                        const lit = hover === i;
                        const phi = ((-90 - (i + 0.5) * SPAN) * Math.PI) / 180;
                        const ink = lit ? onPrimary : there ? text : muted;
                        return (
                            <View key={w.key} style={{ position: 'absolute', left: RM * Math.cos(phi) - 24, top: RM * Math.sin(phi) - 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: there ? 1 : 0.7, transform: [{ scale: lit ? 1.18 : 1 }] }}>
                                <View>
                                    <Ionicons name={w.icon} size={28} color={ink} />
                                    {!there ? <Ionicons name="lock-closed" size={12} color={muted} style={{ position: 'absolute', right: -8, bottom: -4 }} /> : null}
                                </View>
                            </View>
                        );
                    })}
                </Animated.View>
            ) : null}
            {hint ? (
                <Animated.View pointerEvents="none" style={{ position: 'absolute', right: 14 + DISC + 10, bottom: bottom + 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: surface, borderWidth: 1, borderColor: border, opacity: hintFade, elevation: 6 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 13 }}>{tr('Touch and hold, then slide')}</Text>
                </Animated.View>
            ) : null}
            <Animated.View ref={anchor} collapsable={false} {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={tr('Open one of your cards. Touch and hold, then slide to choose.')}
                style={{ position: 'absolute', right: 14, bottom, width: DISC, height: DISC, borderRadius: DISC / 2, elevation: 10, shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, transform: [{ scale: press }] }}>
                {/* the glossy button: a gradient body, a glass highlight on the upper half, a light edge */}
                <LinearGradient colors={[primaryLight || primary, primary, primaryDark || primary]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ flex: 1, borderRadius: DISC / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', overflow: 'hidden' }}>
                    <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.06)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
                        style={{ position: 'absolute', top: 2, left: 7, right: 7, height: DISC * 0.46, borderRadius: DISC / 2 }} />
                    <MiniFan color={onPrimary} />
                </LinearGradient>
            </Animated.View>
        </View>
    );
}
