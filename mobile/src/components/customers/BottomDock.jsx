// A radial (pie) menu at the bottom right instead of a pile of cards. With two or more of the cards on screen (cart, dine in table, reserved table, order or
// tracking), their cards step aside and this round button stays, with the icons of what is there on it. Touch and hold it: a quarter circle opens to the
// left and up, a ring split into four wedges (Dine in, Track, Table QR, Cart). Slide onto a wedge to light it, let go to open it. A wedge with nothing
// behind it is dimmed with a lock and cannot be chosen. A quick tap opens the dine in table if there is one, else the cart, else the first card.
// Drawn from plain views (many thin rotated bars), so it needs no extra package.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, PanResponder, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

export default function BottomDock({ navRef }) {
    const items = useDock((s) => s.items);
    const list = dockList(items);
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, surface, text, muted, border } = useBrand();
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(-1);
    const anchor = useRef(null);
    const centre = useRef({ x: 0, y: 0 });
    const timer = useRef(null);
    const fade = useRef(new Animated.Value(0)).current;

    // what each wedge opens now (null = nothing behind it: locked)
    const target = (k) => (k === 'track' ? (items.track || items.order) : items[k]) || null;
    const live = useRef({});
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
    const close = () => { clearTimeout(timer.current); live.current.open = false; setOpen(false); setHover(-1); };

    const pan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
            anchor.current?.measureInWindow?.((x, y, w, h) => { centre.current = { x: x + w / 2, y: y + h / 2 }; });
            timer.current = setTimeout(() => { live.current.open = true; setOpen(true); }, 180);
        },
        onPanResponderMove: (_, g) => { if (live.current.open) setHover(wedgeAt(g.moveX, g.moveY)); },
        onPanResponderRelease: (_, g) => {
            const l = live.current;
            if (l.open) { const i = wedgeAt(g.moveX, g.moveY); close(); if (i >= 0) go(l.target(WEDGES[i].key)); return; }
            close();
            go(l.items.table || l.items.cart || l.list[0]);   // a quick tap
        },
        onPanResponderTerminate: close,
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
                            <View key={w.key} style={{ position: 'absolute', left: RM * Math.cos(phi) - 34, top: RM * Math.sin(phi) - 24, width: 68, height: 48, alignItems: 'center', justifyContent: 'center', opacity: there ? 1 : 0.7 }}>
                                <View>
                                    <Ionicons name={w.icon} size={22} color={ink} />
                                    {!there ? <Ionicons name="lock-closed" size={11} color={muted} style={{ position: 'absolute', right: -8, bottom: -3 }} /> : null}
                                </View>
                                <Text numberOfLines={1} style={{ color: ink, fontSize: 10.5, fontWeight: '800', marginTop: 2 }}>{tr(w.label)}</Text>
                            </View>
                        );
                    })}
                </Animated.View>
            ) : null}
            <View ref={anchor} collapsable={false} {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={tr('Open one of your cards. Touch and hold, then slide to choose.')}
                style={{ position: 'absolute', right: 14, bottom, width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
                <View style={{ width: 40, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
                    {list.slice(0, 4).map((it) => <Ionicons key={it.key} name={it.icon} size={list.length > 2 ? 17 : 20} color={onPrimary} style={{ margin: 1.5 }} />)}
                </View>
            </View>
        </View>
    );
}
