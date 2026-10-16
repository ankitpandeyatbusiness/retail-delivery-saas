// The customer app's floating tab bar and tab animations, shared with the owner panel so both look and move the same:
// a rounded highlight that slides under the active tab, the icon springing up, pages that slide with the tabs, and the
// "gate" that keeps a tab switch from starting on top of a page that is still sliding.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Keyboard, StyleSheet, Platform, Dimensions } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../components/common/kit';
import { useMotion } from '../components/common/motion';

const tb = StyleSheet.create({
    badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
    badgeTxt: { fontSize: 10, fontWeight: '800' },
    floatBar: {
        flexDirection: 'row', alignItems: 'center', height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
        shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    },
    floatPill: { position: 'absolute', left: 0, top: 7, bottom: 7, borderRadius: 24 },
    // the highlight is exactly as wide as its tab (minus a small gap), so the last tab can never poke out of the bar
    floatItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    floatInner: { width: '100%', paddingHorizontal: 2, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    floatBadge: { position: 'absolute', top: -6, right: -12 },
    floatLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 3 },
});

// While a page is sliding in or out (the stack transition), a tab switch is NOT started on top of it: two
// transitions at once left the leaving page showing over the tab that slid in. The tap is kept and played the
// moment the page has finished moving (never more than half a second later).
export const gate = { busy: false, pending: null, timer: null };
let navRef = null;
export const bindGateNavigation = (ref) => { navRef = ref; };
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
    if (name && navRef && navRef.isReady()) navRef.dispatch(CommonActions.navigate({ name }));
}

// progress is -1 for a tab left of the open one, 0 for the open one, 1 for a tab to its right.
// The pages slide the FULL width, so a page that is not open is parked completely off the screen.
// (No opacity on purpose: on Android a card's shadow ignores its parent's opacity, so a "hidden" page that is
// parked on screen still shows its card shadows as a ghost. Off screen there is nothing to show.)
export const slideScenes = ({ current }) => {
    const W = Dimensions.get('window').width + 24;   // a little extra so no shadow reaches the edge
    return {
        sceneStyle: {
            transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-W, 0, W] }) }],
        },
    };
};

// the icon springs up a little when its tab becomes active
export function TabGlyph({ focused, color, icon, size = 22 }) {
    const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
    const motion = useMotion();
    useEffect(() => {
        if (motion === 'off') { v.setValue(focused ? 1 : 0); return; }
        Animated.spring(v, { toValue: focused ? 1 : 0, friction: 5, tension: 170, useNativeDriver: true }).start();
    }, [focused, motion, v]);
    return (
        <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
            <Ionicons name={focused ? icon : `${icon}-outline`} size={size} color={color} />
        </Animated.View>
    );
}

// the cart count: pops each time the number changes
export function CountBadge({ n }) {
    const { primary, onPrimary } = useBrand();
    const v = useRef(new Animated.Value(1)).current;
    const last = useRef(n);
    useEffect(() => {
        if (last.current !== n && n > 0) {
            v.setValue(0.6);
            Animated.spring(v, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
        }
        last.current = n;
    }, [n, v]);
    if (!n) return null;
    return (
        <Animated.View style={[tb.badge, { backgroundColor: primary, transform: [{ scale: v }] }]}>
            <Text style={[tb.badgeTxt, { color: onPrimary }]}>{n > 9 ? '9+' : n}</Text>
        </Animated.View>
    );
}

// One tab: the icon (springs up when active), its label, and the cart count when there is one.
function TabItem({ focused, icon, label, badge, onPress, onLongPress }) {
    const { primary, muted } = useBrand();
    return (
        <Pressable onPress={onPress} onLongPress={onLongPress} style={tb.floatItem} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}}>
            <View style={tb.floatInner}>
                <View>
                    <TabGlyph focused={focused} color={focused ? primary : muted} icon={icon || 'ellipse'} />
                    {typeof badge === 'number' ? <View style={tb.floatBadge}><CountBadge n={badge} /></View> : null}
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[tb.floatLabel, { color: focused ? primary : muted }]}>{label}</Text>
            </View>
        </Pressable>
    );
}

// A rounded bar that floats above the screen.
export function FloatingTabBar({ state, descriptors, navigation, defs }) {
    const insets = useSafeAreaInsets();
    const { primary, background, surface, border, dark } = useBrand();
    const motion = useMotion();
    const [kb, setKb] = useState(false);
    const [w, setW] = useState(0);
    const slide = useRef(new Animated.Value(state.index)).current;
    useEffect(() => {
        if (motion === 'off') { slide.setValue(state.index); return; }
        // same duration and curve as the page slide, so the highlight and the page arrive together
        Animated.timing(slide, { toValue: state.index, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [state.index, motion, slide]);

    useEffect(() => {
        const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
        const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
        return () => { a.remove(); b.remove(); };
    }, []);

    if (kb) return null;
    return (
        <View style={{ backgroundColor: background, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4 }}>
            <View
                onLayout={(e) => setW(e.nativeEvent.layout.width)}
                style={[tb.floatBar, { backgroundColor: surface, borderColor: border, shadowColor: dark ? '#000000' : primary }]}
            >
                {/* exactly as wide as one tab (minus a small gap), so it can never poke out of the bar */}
                {w ? (
                    <Animated.View
                        pointerEvents="none"
                        style={[tb.floatPill, {
                            width: w / state.routes.length - 10,
                            backgroundColor: alpha(primary, 0.14),
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
                            icon={d.icon}
                            label={d.label || route.name}
                            badge={descriptors[route.key].options.tabBarBadge}
                            onPress={onPress}
                            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                        />
                    );
                })}
            </View>
        </View>
    );
}

