// One slider: the same sheet as the new-order one (components/owners/NewOrderPopup.jsx) - full width, rounded top, a grip bar, an icon, a big title.
//   - an alert that only informs closes by itself after `sec` seconds; a bar across the top counts it down (like a WhatsApp status)
//   - touch and hold it anywhere: the bar waits, so it can be read.  Double-tap: the bar stops where it is and stays until the next double-tap.
//   - swipe it down: it goes away at once
//   - "Turn off this slider" switches this alert's slider off for good (Alerts screen turns it on again)
// sec 0 = it needs an answer: no bar, no timer, it stays until the person acts or closes it.
// `actions` = [{ label, onPress, kind }] answers shown as text buttons (Approve / Reject). Everything is drawn without a shadow and without
// dimming the screen, so the app behind stays usable.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, PanResponder, Easing, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from './kit';
import { tr } from '../../i18n';
import { useIsDesktopWeb } from '../../utils/common/layout';

const DOUBLE_TAP_MS = 320;
const TAP_MS = 250;

export default function AlertSlider({ item, sec, onClose, onOpen, onTurnOff, actions }) {
    const { surface, text, muted, primary, border, onPrimary, error } = useBrand();
    const insets = useSafeAreaInsets();
    const desk = useIsDesktopWeb();   // a computer: a compact card in the bottom-right corner instead of the phone's full-width sheet
    const timed = sec > 0;
    const total = sec * 1000;

    const [pinned, setPinned] = useState(false);
    const slide = useRef(new Animated.Value(0)).current;   // 0 below the screen, 1 in place
    const drag = useRef(new Animated.Value(0)).current;    // the finger pulling it down
    const bar = useRef(new Animated.Value(1)).current;     // 1 full, 0 empty
    const remain = useRef(total);
    const closing = useRef(false);
    const pinnedRef = useRef(false);
    const holding = useRef(false);
    const lastTap = useRef(0);
    const touchAt = useRef(0);

    const close = () => {
        if (closing.current) return;
        closing.current = true;
        bar.stopAnimation();
        Animated.timing(slide, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
    };
    const closeRef = useRef(close);
    closeRef.current = close;

    const run = () => {
        if (!timed || closing.current || pinnedRef.current || holding.current) return;
        Animated.timing(bar, { toValue: 0, duration: Math.max(60, remain.current), easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => { if (finished) closeRef.current(); });
    };
    const pause = () => { bar.stopAnimation((v) => { remain.current = v * total; }); };

    useEffect(() => {
        Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        run();
        return () => bar.stopAnimation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pan = useRef(PanResponder.create({
        // a button inside takes its own touch first; anywhere else on the sheet, this one holds, taps and drags
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => { touchAt.current = Date.now(); holding.current = true; if (timed) pause(); },
        onPanResponderMove: (_, g) => { if (g.dy > 0) drag.setValue(g.dy); },
        onPanResponderRelease: (_, g) => {
            holding.current = false;
            if (g.dy > 60 || g.vy > 0.9) { closeRef.current(); return; }
            Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
            const quick = Date.now() - touchAt.current < TAP_MS && Math.abs(g.dy) < 8 && Math.abs(g.dx) < 8;
            if (quick && timed) {
                const now = Date.now();
                if (now - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = 0; pinnedRef.current = !pinnedRef.current; setPinned(pinnedRef.current); }
                else lastTap.current = now;
            }
            if (timed && !pinnedRef.current) run();
        },
        onPanResponderTerminate: () => { holding.current = false; Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(); if (timed && !pinnedRef.current) run(); },
    })).current;

    if (desk) {
        const tx = slide.interpolate({ inputRange: [0, 1], outputRange: [440, 0] });   // it slides in from the right
        return (
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 24, bottom: 24, width: 400, maxWidth: '92%', zIndex: 1000 }}>
                {/* the pointer on the card holds the countdown (like touch and hold on a phone); it goes on when the pointer leaves */}
                <Pressable
                    onHoverIn={() => { holding.current = true; if (timed) pause(); }}
                    onHoverOut={() => { holding.current = false; if (timed && !closing.current) run(); }}
                    accessible={false}
                    style={{ cursor: 'default' }}
                >
                    <Animated.View style={{ transform: [{ translateX: tx }], backgroundColor: surface, borderColor: border, borderWidth: 1, borderRadius: 22, padding: 18, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.28), 0 4px 14px rgba(0,0,0,0.08)' }}>
                        {timed ? (
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: alpha(primary, 0.15) }}>
                                <Animated.View style={{ height: 3, backgroundColor: primary, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
                            </View>
                        ) : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="notifications" size={21} color={primary} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                <Text style={{ color: text, fontSize: 16.5, fontWeight: '900' }} numberOfLines={2}>{item.title}</Text>
                            </View>
                            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={tr('Close')} style={({ hovered }) => ({ width: 32, height: 32, borderRadius: 16, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? alpha(muted, 0.16) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
                                <Ionicons name="close" size={20} color={muted} />
                            </Pressable>
                        </View>
                        {item.body ? <Text style={{ color: muted, fontSize: 14, marginTop: 10, lineHeight: 20 }} numberOfLines={5}>{item.body}</Text> : null}
                        {(actions && actions.length) || onOpen ? (
                            <View style={{ flexDirection: 'row', marginTop: 14 }}>
                                {(actions || []).map((a, i) => (
                                    <Pressable key={a.label} onPress={a.onPress} accessibilityRole="button"
                                        style={({ hovered }) => ({ flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, marginRight: i < actions.length - 1 || onOpen ? 8 : 0, backgroundColor: a.kind === 'danger' ? alpha(error, hovered ? 0.24 : 0.14) : primary, borderWidth: a.kind === 'danger' ? 1 : 0, borderColor: alpha(error, 0.5), filter: hovered && a.kind !== 'danger' ? 'brightness(1.1)' : 'none', cursor: 'pointer', transitionProperty: 'background-color, filter', transitionDuration: '140ms' })}>
                                        <Text style={{ color: a.kind === 'danger' ? error : onPrimary, fontWeight: '900', fontSize: 14.5 }}>{a.label}</Text>
                                    </Pressable>
                                ))}
                                {onOpen ? (
                                    <Pressable onPress={onOpen} accessibilityRole="button" style={({ hovered }) => ({ flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, borderWidth: 1.5, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.07) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                        <Text style={{ color: text, fontWeight: '800', fontSize: 14.5 }}>{tr('View')}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        ) : null}
                        <Pressable onPress={onTurnOff} accessibilityRole="button" style={({ hovered }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, backgroundColor: hovered ? alpha(muted, 0.12) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
                            <Ionicons name="notifications-off-outline" size={14} color={muted} />
                            <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 6 }}>{tr('Turn off this slider')}</Text>
                        </Pressable>
                    </Animated.View>
                </Pressable>
            </View>
        );
    }

    const translateY = Animated.add(slide.interpolate({ inputRange: [0, 1], outputRange: [360, 0] }), drag);
    const pad = Math.max(insets.bottom, 12) + 10;
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}>
            <Animated.View
                {...pan.panHandlers}
                style={[s.sheet, { transform: [{ translateY }], backgroundColor: surface, borderColor: border, paddingBottom: pad }]}
            >
                {timed ? (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: alpha(primary, 0.15) }}>
                        {/* the bar is never swapped or restarted: pinned or held, it simply stays where it is */}
                        <Animated.View style={{ height: 3, backgroundColor: primary, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
                    </View>
                ) : null}
                <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 12 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="notifications" size={22} color={primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 20, fontWeight: '900' }} numberOfLines={2}>{item.title}</Text>
                    </View>
                    {pinned ? <Ionicons name="pin" size={18} color={primary} style={{ marginRight: 10 }} /> : null}
                    <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('Close')}><Ionicons name="close" size={24} color={muted} /></Pressable>
                </View>
                {item.body ? <Text style={{ color: muted, fontSize: 14.5, marginTop: 12, lineHeight: 21 }} numberOfLines={5}>{item.body}</Text> : null}

                <View style={{ flexDirection: 'row', marginTop: 16 }}>
                    {(actions || []).map((a, i) => (
                        <Pressable
                            key={a.label}
                            onPress={a.onPress}
                            accessibilityRole="button"
                            style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, marginRight: i < actions.length - 1 || onOpen ? 8 : 0, backgroundColor: a.kind === 'danger' ? alpha(error, 0.14) : primary, borderWidth: a.kind === 'danger' ? 1 : 0, borderColor: alpha(error, 0.5) }}
                        >
                            <Text style={{ color: a.kind === 'danger' ? error : onPrimary, fontWeight: '900', fontSize: 15 }}>{a.label}</Text>
                        </Pressable>
                    ))}
                    {onOpen ? (
                        <Pressable onPress={onOpen} accessibilityRole="button" style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: border }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr('View')}</Text>
                        </Pressable>
                    ) : null}
                </View>
                <Pressable onPress={onTurnOff} hitSlop={8} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', marginTop: 14 }} accessibilityRole="button">
                    <Ionicons name="notifications-off-outline" size={15} color={muted} />
                    <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 6 }}>{tr('Turn off this slider')}</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    // the same shape as the new-order sheet, but flat: no shadow
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, padding: 18, overflow: 'hidden' },
});
