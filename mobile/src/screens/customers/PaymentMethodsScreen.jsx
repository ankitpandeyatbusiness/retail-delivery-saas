// src/screens/PaymentMethodsScreen.jsx
// Cash on delivery, pay online straight from an installed UPI app (GPay, PhonePe, Paytm...), or by credit / debit card.
// What is offered comes from the server (GET /orders/payment-config), so a shop without online payments shows only cash.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing, ActivityIndicator, Image } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../../components/common/kit';
import { tint } from '../../components/customers/shop';
import { fetchPaymentConfig } from '../../api/customers/shopApi';
import { standardUpiApps } from '../../utils/customers/upiApps';
import { prewarmPayments } from '../../utils/customers/payOnline';
import { usePayChoice } from '../../store/customers/usePayChoice';

// one selectable row. `mark` + `color` draw a small app badge, otherwise `icon` is used.
function MethodCard({ m, index, selected, onPick }) {
    const { primary, text, surface, border, muted } = useBrand();
    const enter = useRef(new Animated.Value(0)).current;
    const press = useRef(new Animated.Value(1)).current;
    const sel = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(enter, { toValue: 1, duration: 380, delay: index * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
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
                {m.logo ? (
                    <View style={[s.iconBox, s.logoBox, { borderColor: border }]}>
                        <Image source={{ uri: m.logo }} style={s.logo} resizeMode="contain" />
                    </View>
                ) : m.mark ? (
                    <View style={[s.iconBox, { backgroundColor: primary }]}>
                        <Text style={s.mark}>{m.mark}</Text>
                    </View>
                ) : (
                    <View style={[s.iconBox, { backgroundColor: selected ? primary : tint(primary) }]}>
                        <Ionicons name={m.icon} size={22} color={selected ? '#FFFFFF' : primary} />
                    </View>
                )}
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

    // selection key: 'cod' or 'upi:<package name>'
    const cur = route.params?.current || 'cod';
    const [picked, setPicked] = useState(cur === 'upi' && route.params?.currentApp ? `upi:${route.params.currentApp}` : cur === 'card' ? 'card' : 'cod');
    const [cfg, setCfg] = useState({ loading: true, online: false, upi: false, card: false });
    const [apps, setApps] = useState(null);   // null while we ask the phone which UPI apps it has
    const timer = useRef(null);
    const head = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(head, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        let on = true;
        fetchPaymentConfig()
            .then((r) => {
                prewarmPayments(r);   // start the payment SDK now, so tapping a UPI app later opens it at once
                const ms = r.methods || [];
                if (on) setCfg({ loading: false, online: !!r.online, upi: !!r.online && ms.includes('upi'), card: !!r.online && ms.includes('card') });
            })
            .catch(() => { if (on) setCfg({ loading: false, online: false, upi: false, card: false }); });
        standardUpiApps().then((a) => { if (on) setApps(a); });
        return () => { on = false; clearTimeout(timer.current); };
    }, []);

    const selectMethod = (m) => {
        if (timer.current) return;
        if (m.value === 'card') { nav.navigate('CardDetails', { depth: 2 }); return; }   // the card is entered on its own screen
        setPicked(m.key);
        // short pause so the user sees the tick animation, then go back to the cart
        timer.current = setTimeout(() => {
            usePayChoice.getState().choose({ label: m.cartLabel, value: m.value, upiApp: m.app });
            nav.goBack();   // back to the SAME cart screen (navigate('Cart') would stack a second one)
        }, 260);
    };

    const cash = { key: 'cod', value: 'cod', label: 'Cash on Delivery', cartLabel: 'Cash on Delivery', icon: 'cash-outline', desc: 'Pay in cash or UPI when the order arrives' };
    const cardRow = { key: 'card', value: 'card', label: 'Credit / Debit card', cartLabel: 'Credit / Debit card', icon: 'card-outline', desc: 'Visa, Mastercard, RuPay. You confirm with your bank OTP' };
    const upiRows = [
        ...(apps || []).map((a) => ({
            key: `upi:${a.pkg}`, value: 'upi', app: { pkg: a.pkg, label: a.label }, label: a.label, cartLabel: `${a.label} (UPI)`,
            logo: a.logo, mark: a.mark || a.label.slice(0, 1).toUpperCase(), desc: `Pay with ${a.label}. It opens directly`,
        })),
    ];

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

                <Text style={[s.title, { color: muted }]}>PAY ONLINE</Text>
                {cfg.loading || apps === null ? (
                    <ActivityIndicator color={primary} style={{ marginVertical: 18 }} />
                ) : !cfg.online ? (
                    <Text style={[s.note, { color: muted }]}>Online payment is not available for this shop right now.</Text>
                ) : (
                    <>
                        {cfg.upi ? upiRows.map((m, i) => (
                            <MethodCard key={m.key} m={m} index={i} selected={picked === m.key} onPick={selectMethod} />
                        )) : null}
                        {cfg.card ? (
                            <MethodCard m={cardRow} index={upiRows.length} selected={picked === 'card'} onPick={selectMethod} />
                        ) : null}
                    </>
                )}

                <Text style={[s.title, { color: muted }]}>PAY ON DELIVERY</Text>
                <MethodCard m={cash} index={upiRows.length + 1} selected={picked === 'cod'} onPick={selectMethod} />
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
    note: { fontSize: 13, fontWeight: '500', lineHeight: 19, marginBottom: 6 },
    card: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1.5, borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
    glow: { borderRadius: 16 },
    iconBox: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    mark: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
    logoBox: { backgroundColor: '#FFFFFF', borderWidth: 1, overflow: 'hidden' },
    logo: { width: 30, height: 30 },
    textCol: { flex: 1 },
    label: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
    desc: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
});
