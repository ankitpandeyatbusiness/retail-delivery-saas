// src/screens/PaymentMethodsScreen.jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../components/ui/kit';
import { tint } from '../components/ui/shop';

const METHODS = [
    { id: 'cod', label: 'Cash on Delivery', icon: 'cash-outline', desc: 'Pay in cash or UPI when order arrives' },
    { id: 'upi', label: 'UPI (GPay, PhonePe, Paytm)', icon: 'scan-outline', desc: 'Pay instantly via any UPI app' },
    { id: 'card', label: 'Credit / Debit Card', icon: 'card-outline', desc: 'Visa, Mastercard, RuPay' },
    { id: 'wallet', label: 'Wallets', icon: 'wallet-outline', desc: 'Paytm, Amazon Pay, Mobikwik' },
];

function MethodCard({ m, index, selected, onPick }) {
    const { primary, text, surface, border, muted } = useBrand();
    const enter = useRef(new Animated.Value(0)).current;
    const press = useRef(new Animated.Value(1)).current;
    const sel = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(enter, { toValue: 1, duration: 380, delay: index * 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, []);
    useEffect(() => {
        Animated.spring(sel, { toValue: selected ? 1 : 0, friction: 6, tension: 140, useNativeDriver: true }).start();
    }, [selected]);

    const to = (v) => Animated.spring(press, { toValue: v, friction: 6, tension: 200, useNativeDriver: true }).start();

    return (
        <Animated.View style={{
            opacity: enter,
            transform: [
                { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                { scale: press },
            ],
        }}>
            <Pressable onPress={() => onPick(m)} onPressIn={() => to(0.97)} onPressOut={() => to(1)}
                style={[s.card, { backgroundColor: surface, borderColor: selected ? primary : border }]}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.glow, { backgroundColor: tint(primary), opacity: sel }]} />
                <View style={[s.iconBox, { backgroundColor: selected ? primary : tint(primary) }]}>
                    <Ionicons name={m.icon} size={22} color={selected ? '#FFFFFF' : primary} />
                </View>
                <View style={s.textCol}>
                    <Text style={[s.label, { color: text }]}>{m.label}</Text>
                    <Text style={[s.desc, { color: muted }]}>{m.desc}</Text>
                </View>
                <View style={[s.radio, { borderColor: selected ? primary : muted }]}>
                    <Animated.View style={[s.radioDot, { backgroundColor: primary, transform: [{ scale: sel }], opacity: sel }]} />
                </View>
            </Pressable>
        </Animated.View>
    );
}

export default function PaymentMethodsScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const { primary, text, background, muted } = useBrand();

    const [picked, setPicked] = useState(route.params?.current || 'cod');
    const timer = useRef(null);
    const head = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(head, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        return () => clearTimeout(timer.current);
    }, []);

    const selectMethod = (m) => {
        if (timer.current) return;
        setPicked(m.id);
        // short pause so the user sees the tick animation, then go back to the cart
        timer.current = setTimeout(() => {
            nav.navigate('Cart', { selectedPaymentMethod: m.label, paymentMethodValue: m.id });
        }, 260);
    };

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <BackHeader title="Payment Options" />
            <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
                <Animated.View style={[s.secure, {
                    backgroundColor: tint(primary), opacity: head,
                    transform: [{ translateY: head.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
                }]}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={primary} />
                    <Text style={[s.secureTxt, { color: text }]}>Your payment details are safe and secure</Text>
                </Animated.View>

                <Text style={[s.title, { color: muted }]}>RECOMMENDED</Text>
                {METHODS.map((m, i) => (
                    <MethodCard key={m.id} m={m} index={i} selected={picked === m.id} onPick={selectMethod} />
                ))}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    pad: { padding: 16, paddingBottom: 40 },
    secure: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 8 },
    secureTxt: { flex: 1, marginLeft: 10, fontSize: 13, fontWeight: '700' },
    title: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 12, marginTop: 16 },
    card: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1.5, borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
    glow: { borderRadius: 16 },
    iconBox: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    textCol: { flex: 1 },
    label: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
    desc: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
});