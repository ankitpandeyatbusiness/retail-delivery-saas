// src/screens/customers/OrderPlacedScreen.jsx
//
// The moment after "Place order": a tick draws in with a ring pulse and a light confetti burst, then the summary
// slides up with two clear next steps. Shown instead of an instant jump to the Orders list.
// Back goes to the Orders tab (the stack under it); "Track order" opens the order itself.
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Pressable, BackHandler } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, CardGlow } from '../../components/common/kit';
import { useMotion } from '../../components/common/motion';
import { Press, rs } from '../../components/customers/cartParts';
import { tr } from '../../i18n';
import { playSfx } from '../../utils/common/sfx';

const PIECES = 18;
const HALO = 150;   // size of the area the confetti flies over

// every piece gets its own direction, distance, spin and colour; all of them are driven by ONE native value
function useConfetti(colors) {
    return useMemo(() => Array.from({ length: PIECES }).map((_, i) => {
        const a = (Math.PI * 2 * i) / PIECES + (i % 2 ? 0.18 : -0.12);
        const far = 90 + ((i * 37) % 70);
        return {
            dx: Math.cos(a) * far,
            up: Math.sin(a) * far - 24,
            fall: Math.sin(a) * far + 70 + ((i * 13) % 40),
            spin: ((i % 2 ? 1 : -1) * (180 + ((i * 53) % 300))),
            w: 6 + (i % 3) * 3,
            h: 9 + (i % 4) * 2,
            round: i % 4 === 0,
            color: colors[i % colors.length],
        };
    }), [colors]);
}

export default function OrderPlacedScreen() {
    const nav = useNavigation();
    const { id, orderNo, total, paid, method, type, etaMin } = useRoute().params || {};
    const insets = useSafeAreaInsets();
    const { primary, primaryLight, primaryDark, onPrimary, accent, ok, text, muted, background, surface, border, radius } = useBrand();
    const motion = useMotion();
    const still = motion === 'off';

    const pop = useRef(new Animated.Value(still ? 1 : 0)).current;      // the disc and its tick
    const ring = useRef(new Animated.Value(still ? 1 : 0)).current;     // the ring that expands once
    const burst = useRef(new Animated.Value(still ? 1 : 0)).current;    // the confetti
    const rise = useRef(new Animated.Value(still ? 1 : 0)).current;     // the text and the card

    // the "done" chime, once, as the tick pops (not on silent phones, see sfx.js)
    useEffect(() => { playSfx('orderPlaced'); }, []);

    useEffect(() => {
        if (still) return undefined;
        const a = Animated.sequence([
            Animated.spring(pop, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
            Animated.parallel([
                Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                Animated.timing(burst, { toValue: 1, duration: motion === 'subtle' ? 0 : 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
                Animated.timing(rise, { toValue: 1, duration: 420, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            ]),
        ]);
        a.start();
        return () => a.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // the hardware back button leaves this page to the Orders tab, like the back arrow would
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => { nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs', state: { routes: [{ name: 'Orders' }] } }] })); return true; });
        return () => sub.remove();
    }, [nav]);

    const confetti = useConfetti([primary, accent, ok, '#FFFFFF', primaryLight]);

    const goOrder = () => nav.dispatch(CommonActions.reset({
        index: 1,
        routes: [{ name: 'MainTabs', state: { routes: [{ name: 'Orders' }] } }, { name: 'OrderDetail', params: { id } }],
    }));
    const goMenu = () => nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs', state: { routes: [{ name: 'Home' }] } }] }));

    const rows = [];
    if (total != null) rows.push(['Total', rs(total)]);
    rows.push(['Payment', paid ? 'Paid online' : (method || 'Pay on delivery')]);
    if (etaMin) rows.push([type === 'pickup' || type === 'dine_in' ? 'Ready in about' : 'Arriving in about', `${etaMin} min`]);

    return (
        <View style={[s.root, { backgroundColor: background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
            <View style={s.top}>
                <View style={s.stage}>
                    {/* the ring */}
                    <Animated.View
                        pointerEvents="none"
                        style={[s.ring, { borderColor: primary, opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.1] }) }] }]}
                    />
                    {/* confetti */}
                    {motion === 'full' ? confetti.map((c, i) => (
                        <Animated.View
                            key={i}
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                width: c.w, height: c.round ? c.w : c.h, borderRadius: c.round ? c.w / 2 : 2, backgroundColor: c.color,
                                opacity: burst.interpolate({ inputRange: [0, 0.08, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                                transform: [
                                    { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, c.dx] }) },
                                    { translateY: burst.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, c.up, c.fall] }) },
                                    { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.spin}deg`] }) },
                                ],
                            }}
                        />
                    )) : null}
                    {/* the disc and its tick */}
                    <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }], opacity: pop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }) }}>
                        <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.disc}>
                            <Ionicons name="checkmark" size={58} color={onPrimary} />
                        </LinearGradient>
                    </Animated.View>
                </View>

                <Animated.View style={{ alignItems: 'center', opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
                    <Text style={[s.title, { color: text }]}>{tr('Order placed!')}</Text>
                    <Text style={[s.sub, { color: muted }]}>
                        {orderNo ? tr('Order #{orderNo} is on its way to the kitchen.', { orderNo: orderNo }) : tr('Your order is on its way to the kitchen.')}
                    </Text>

                    <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                        <CardGlow radius={18} from="tl" strength={0.16} />
                        {rows.map(([k, v], i) => (
                            <View key={k} style={[s.row, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
                                <Text style={[s.k, { color: muted }]}>{k}</Text>
                                <Text style={[s.v, { color: text }]}>{v}</Text>
                            </View>
                        ))}
                    </View>
                </Animated.View>
            </View>

            <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
                <Press onPress={goOrder} style={[s.main, { backgroundColor: primary, borderRadius: radius }]}>
                    <Ionicons name="navigate-outline" size={18} color={onPrimary} />
                    <Text style={[s.mainTxt, { color: onPrimary }]}>{tr('Track order')}</Text>
                </Press>
                <Pressable onPress={goMenu} hitSlop={8} style={s.ghost}>
                    <Text style={[s.ghostTxt, { color: primary }]}>{tr('Back to menu')}</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 20 },
    top: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    stage: { width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    ring: { position: 'absolute', width: 112, height: 112, borderRadius: 56, borderWidth: 3 },
    disc: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.6, marginTop: 8 },
    sub: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 12 },
    card: { alignSelf: 'stretch', minWidth: 290, marginTop: 24, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    k: { fontSize: 13, fontWeight: '600' },
    v: { fontSize: 14, fontWeight: '800' },
    main: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    mainTxt: { fontSize: 16, fontWeight: '900' },
    ghost: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20 },
    ghostTxt: { fontSize: 14, fontWeight: '800' },
});
