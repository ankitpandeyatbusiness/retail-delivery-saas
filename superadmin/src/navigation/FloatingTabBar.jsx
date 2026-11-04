// The floating tab bar of the shop app, for the superadmin app: a rounded bar that floats above the page, a highlight that SLIDES under the
// active tab at the same pace as the page, the icon springing up, and the "gate" that keeps a tab press from starting on top of a page that is still sliding.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Keyboard, StyleSheet, Platform } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { useTheme, section } from '../theme';
import { navigationRef } from './ref';

const SLIDE_MS = 400;   // the same as the tabs' page slide (TAB_SLIDE_MS in RootNavigator)

const tb = StyleSheet.create({
    floatBar: {
        flexDirection: 'row', alignItems: 'center', height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
        shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    },
    floatPill: { position: 'absolute', left: 0, top: 7, bottom: 7, borderRadius: 24 },
    // the highlight is exactly as wide as its tab (minus a small gap), so the last tab can never poke out of the bar
    floatItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    floatInner: { width: '100%', paddingHorizontal: 2, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    floatLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 3 },
});

// While a page is sliding in or out (the stack transition), a tab press is NOT started on top of it: two transitions at once leave the
// leaving page showing over the tab that slid in. The tap is kept and played the moment the page has stopped (never more than half a second later).
export const gate = { busy: false, pending: null, timer: null };
export const holdGate = () => {
    gate.busy = true;
    clearTimeout(gate.timer);
    gate.timer = setTimeout(() => releaseGate(), 500);   // safety: never stay held
};
export function releaseGate() {
    gate.busy = false;
    clearTimeout(gate.timer);
    const name = gate.pending;
    gate.pending = null;
    if (name && navigationRef.isReady()) navigationRef.dispatch(CommonActions.navigate({ name }));
}

// the icon springs up a little when its tab becomes active
function TabGlyph({ focused, color, icon }) {
    const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
    useEffect(() => { Animated.spring(v, { toValue: focused ? 1 : 0, friction: 5, tension: 170, useNativeDriver: true }).start(); }, [focused, v]);
    return (
        <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
            <Icon name={icon} size={22} color={color} filled={focused} />
        </Animated.View>
    );
}

function TabItem({ focused, icon, label, color, muted, onPress, onLongPress }) {
    const tone = focused ? color : muted;
    return (
        <Pressable onPress={onPress} onLongPress={onLongPress} style={tb.floatItem} accessibilityRole="button" accessibilityLabel={label} accessibilityState={focused ? { selected: true } : {}}>
            <View style={tb.floatInner}>
                <TabGlyph focused={focused} color={tone} icon={icon} />
                <Text numberOfLines={1} style={[tb.floatLabel, { color: tone }]}>{label}</Text>
            </View>
        </Pressable>
    );
}

// defs: { RouteName: { icon, section } }
export default function FloatingTabBar({ state, descriptors, navigation, defs }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const [kb, setKb] = useState(false);
    const [w, setW] = useState(0);
    const slide = useRef(new Animated.Value(state.index)).current;
    useEffect(() => {
        // same duration and curve as the page slide, so the highlight and the page arrive together
        Animated.timing(slide, { toValue: state.index, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [state.index, slide]);

    useEffect(() => {
        const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
        const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
        return () => { a.remove(); b.remove(); };
    }, []);

    if (kb) return null;
    const active = section(t, (defs[state.routes[state.index].name] || {}).section || 'platform');
    return (
        <View style={{ backgroundColor: t.bg, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4 }}>
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[tb.floatBar, { backgroundColor: t.surface, borderColor: t.border, shadowColor: t.dark ? '#000000' : active.color }]}>
                {w ? (
                    <Animated.View
                        pointerEvents="none"
                        style={[tb.floatPill, {
                            width: w / state.routes.length - 10,
                            backgroundColor: active.soft,
                            transform: [{ translateX: Animated.add(Animated.multiply(slide, w / state.routes.length), 5) }],
                        }]}
                    />
                ) : null}
                {state.routes.map((route, i) => {
                    const focused = state.index === i;
                    const d = defs[route.name] || {};
                    const onPress = () => {
                        const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
                    };
                    return (
                        <TabItem
                            key={route.key}
                            focused={focused}
                            icon={d.icon || 'menu'}
                            label={descriptors[route.key].options.title || route.name}
                            color={section(t, d.section || 'platform').color}
                            muted={t.muted}
                            onPress={onPress}
                            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                        />
                    );
                })}
            </View>
        </View>
    );
}
