// Full-screen skeleton shown from the moment "Place order" is tapped on an online order, until the chosen UPI app
// opens. The payment is being prepared in the background (Razorpay's own screen is see-through, see
// plugins/withTranslucentRazorpay.js), so the customer only ever sees this.
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, mix } from './kit';

function Bar({ w, h, r = 10, style, shine, base }) {
    return (
        <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: base, overflow: 'hidden' }, style]}>
            {shine}
        </View>
    );
}

export default function PayShimmer({ appName }) {
    const insets = useSafeAreaInsets();
    const { primary, text, muted, background } = useBrand();
    const x = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [x]);

    const base = mix(background, text, 0.08);
    const light = mix(background, '#FFFFFF', 0.55);
    const tx = x.interpolate({ inputRange: [0, 1], outputRange: [-260, 360] });
    // one moving highlight, copied into every placeholder (each bar clips it)
    const shine = (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }] }]}>
            <LinearGradient
                colors={[`${light}00`, light, `${light}00`]}
                start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                style={{ width: 160, height: '100%' }}
            />
        </Animated.View>
    );
    const B = (p) => <Bar base={base} shine={shine} {...p} />;

    return (
        <View style={[StyleSheet.absoluteFill, s.root, { backgroundColor: background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
            <B w={150} h={22} r={8} />
            <B w={220} h={14} r={7} style={{ marginTop: 10 }} />

            <View style={s.card}>
                <View style={s.row}>
                    <B w={52} h={52} r={26} />
                    <View style={{ marginLeft: 14 }}>
                        <B w={140} h={16} r={8} />
                        <B w={90} h={12} r={6} style={{ marginTop: 8 }} />
                    </View>
                </View>
                <B w="100%" h={1} r={1} style={{ marginVertical: 18 }} />
                <View style={s.rowBetween}><B w={110} h={14} r={7} /><B w={70} h={14} r={7} /></View>
                <View style={[s.rowBetween, { marginTop: 14 }]}><B w={90} h={14} r={7} /><B w={60} h={14} r={7} /></View>
                <View style={[s.rowBetween, { marginTop: 14 }]}><B w={130} h={18} r={9} /><B w={80} h={18} r={9} /></View>
            </View>

            <B w="100%" h={54} r={14} style={{ marginTop: 'auto' }} />
            <Text style={[s.note, { color: muted }]}>{appName ? `Opening ${appName}` : 'Preparing your payment'}…</Text>
            <View style={[s.dot, { backgroundColor: primary }]} />
        </View>
    );
}

const s = StyleSheet.create({
    root: { paddingHorizontal: 20, zIndex: 50, elevation: 50 },
    card: { marginTop: 28, padding: 18, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: '#00000018' },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    note: { textAlign: 'center', fontSize: 13.5, fontWeight: '700', marginTop: 14 },
    dot: { width: 0, height: 0 },
});
