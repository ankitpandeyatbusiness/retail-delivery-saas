// One slider: a card that slides up from the bottom over the app with an alert's title and words.
//   - an alert that only informs closes by itself after `sec` seconds; a bar across the top counts it down (like a WhatsApp status)
//   - touch and hold it anywhere: the bar waits, so it can be read.  Double-tap: it stays until the next double-tap.
//   - swipe it down: it goes away at once
//   - "Turn off this slider" switches this alert's slider off for good (Alerts screen turns it on again)
// sec 0 = it needs an answer: no bar, no timer, it stays until the person closes it.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, PanResponder, Easing, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from './kit';
import { tr } from '../../i18n';

const DOUBLE_TAP_MS = 320;
const TAP_MS = 250;

export default function AlertSlider({ item, sec, onClose, onOpen, onTurnOff }) {
    const { surface, text, muted, primary, border, onPrimary } = useBrand();
    const insets = useSafeAreaInsets();
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
        // a button inside takes its own touch first; anywhere else on the card, this one holds, taps and drags
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

    const translateY = Animated.add(slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }), drag);
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: insets.bottom + 10 }}>
            <Animated.View
                {...pan.panHandlers}
                style={{
                    transform: [{ translateY }], backgroundColor: surface, borderRadius: 22, overflow: 'hidden',
                    borderWidth: 1, borderColor: alpha(primary, 0.35), elevation: 24, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
                }}
            >
                {timed ? (
                    <View style={{ height: 4, backgroundColor: alpha(primary, 0.15) }}>
                        {pinned
                            ? <View style={{ height: 4, backgroundColor: primary }} />
                            : <Animated.View style={{ height: 4, backgroundColor: primary, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />}
                    </View>
                ) : null}
                <View style={{ padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: alpha(primary, 0.15), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <Ionicons name="notifications" size={19} color={primary} />
                        </View>
                        <Text style={{ color: text, fontSize: 16, fontWeight: '900', flex: 1 }} numberOfLines={2}>{item.title}</Text>
                        {pinned ? <Ionicons name="pin" size={16} color={primary} style={{ marginLeft: 8 }} /> : null}
                    </View>
                    {item.body ? <Text style={{ color: muted, fontSize: 14, marginTop: 10, lineHeight: 20 }} numberOfLines={4}>{item.body}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                        <Pressable onPress={onTurnOff} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} accessibilityRole="button">
                            <Ionicons name="notifications-off-outline" size={15} color={muted} />
                            <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 6 }}>{tr('Turn off this slider')}</Text>
                        </Pressable>
                        {onOpen ? (
                            <Pressable onPress={onOpen} style={{ backgroundColor: primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, marginLeft: 10 }} accessibilityRole="button">
                                <Text style={{ color: onPrimary, fontWeight: '800' }}>{tr('Open')}</Text>
                            </Pressable>
                        ) : null}
                        <Pressable onPress={close} style={{ borderWidth: 1, borderColor: border, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, marginLeft: 10 }} accessibilityRole="button">
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('OK')}</Text>
                        </Pressable>
                    </View>
                </View>
            </Animated.View>
        </View>
    );
}
