// src/screens/CardDetailsScreen.jsx
// Credit / debit card entry. The details are NOT saved: they are sent back to the cart in memory, used for this
// one payment and dropped. The bank's OTP (3-D Secure) page is shown by Razorpay's own screen afterwards.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { usePayChoice } from '../../store/customers/usePayChoice';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../../components/common/kit';
import { tint } from '../../components/customers/shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr } from '../../i18n';
import KeyboardScroll from '../../components/common/KeyboardScroll';

const digits = (v) => String(v || '').replace(/\D/g, '');

// 4242 4242 4242 4242 (Amex: 4-6-5)
function groupNumber(v) {
    const d = digits(v).slice(0, 19);
    if (/^3[47]/.test(d)) return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    return d.replace(/(.{4})/g, '$1 ').trim();
}

function luhn(num) {
    let sum = 0;
    let alt = false;
    for (let i = num.length - 1; i >= 0; i -= 1) {
        let n = Number(num[i]);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function brand(num) {
    if (/^4/.test(num)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
    if (/^3[47]/.test(num)) return 'American Express';
    if (/^(60|65|81|82|508)/.test(num)) return 'RuPay';
    return '';
}

export default function CardDetailsScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const depth = route.params?.depth || 1;   // screens to close to get back to the cart (2 when opened from Payment Options)
    const { primary, onPrimary, text, muted, surface, border, background, error } = useBrand();
    const user = useAuthStore((st) => st.user);

    const [number, setNumber] = useState('');
    const [exp, setExp] = useState('');
    const [cvv, setCvv] = useState('');
    const [name, setName] = useState(user?.name || '');
    const [errs, setErrs] = useState({});
    const expRef = useRef(null);
    const cvvRef = useRef(null);
    const nameRef = useRef(null);

    const raw = digits(number);
    const kind = brand(raw);
    const cvvLen = /^3[47]/.test(raw) ? 4 : 3;

    const onExp = (v) => {
        const d = digits(v).slice(0, 4);
        setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
    };

    const submit = () => {
        const e = {};
        if (raw.length < 12 || raw.length > 19 || !luhn(raw)) e.number = 'Enter a valid card number';
        const [mm, yy] = exp.split('/');
        const m = Number(mm);
        const y = 2000 + Number(yy || 0);
        const now = new Date();
        if (!mm || !yy || yy.length !== 2 || m < 1 || m > 12) e.exp = 'Enter expiry as MM/YY';
        else if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) e.exp = 'This card has expired';
        if (digits(cvv).length !== cvvLen) e.cvv = `Enter the ${cvvLen}-digit CVV`;
        if (name.trim().length < 2) e.name = 'Enter the name on the card';
        setErrs(e);
        if (Object.keys(e).length) return;

        usePayChoice.getState().choose({
            label: `${kind || 'Card'} •••• ${raw.slice(-4)}`,
            value: 'card',
            card: { number: raw, month: mm, year: String(y), cvv: digits(cvv), name: name.trim() },
        });
        nav.pop(depth);   // back to the same cart, not a new one
    };

    const field = (label, err, children) => (
        <View style={{ marginBottom: 16 }}>
            <Text style={[s.label, { color: muted }]}>{label}</Text>
            <View style={[s.box, { backgroundColor: surface, borderColor: err ? error : border }]}>{children}</View>
            {err ? <Text style={[s.err, { color: error }]}>{err}</Text> : null}
        </View>
    );

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <BackHeader title={tr('Add card')} />
            <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <KeyboardScroll contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={[s.secure, { backgroundColor: tint(primary) }]}>
                        <Ionicons name="lock-closed-outline" size={18} color={primary} />
                        <Text style={[s.secureTxt, { color: text }]}>{tr('Your card details are not saved. You will confirm with your bank\'s OTP.')}</Text>
                    </View>

                    {field('Card number', errs.number, (
                        <>
                            <TextInput
                                value={groupNumber(number)}
                                onChangeText={(v) => { setNumber(v); if (digits(v).length >= 16) expRef.current?.focus(); }}
                                keyboardType="number-pad"
                                placeholder="1234 5678 9012 3456"
                                placeholderTextColor={muted}
                                maxLength={23}
                                autoComplete="cc-number"
                                style={[s.input, { color: text }]}
                            />
                            {kind ? <Text style={[s.kind, { color: primary }]}>{kind}</Text> : null}
                        </>
                    ))}

                    <View style={s.row}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                            {field('Expiry', errs.exp, (
                                <TextInput
                                    ref={expRef}
                                    value={exp}
                                    onChangeText={(v) => { onExp(v); if (digits(v).length >= 4) cvvRef.current?.focus(); }}
                                    keyboardType="number-pad"
                                    placeholder={tr('MM/YY')}
                                    placeholderTextColor={muted}
                                    maxLength={5}
                                    autoComplete="cc-exp"
                                    style={[s.input, { color: text }]}
                                />
                            ))}
                        </View>
                        <View style={{ flex: 1 }}>
                            {field('CVV', errs.cvv, (
                                <TextInput
                                    ref={cvvRef}
                                    value={cvv}
                                    onChangeText={(v) => { setCvv(digits(v).slice(0, 4)); if (digits(v).length >= cvvLen) nameRef.current?.focus(); }}
                                    keyboardType="number-pad"
                                    secureTextEntry
                                    placeholder="•••"
                                    placeholderTextColor={muted}
                                    maxLength={4}
                                    autoComplete="cc-csc"
                                    style={[s.input, { color: text }]}
                                />
                            ))}
                        </View>
                    </View>

                    {field('Name on card', errs.name, (
                        <TextInput
                            ref={nameRef}
                            value={name}
                            onChangeText={setName}
                            autoCapitalize="words"
                            placeholder={tr('As printed on the card')}
                            placeholderTextColor={muted}
                            autoComplete="cc-name"
                            style={[s.input, { color: text }]}
                        />
                    ))}

                    <Pressable onPress={submit} style={[s.btn, { backgroundColor: primary }]}>
                        <Text numberOfLines={1} style={[s.btnTxt, { color: onPrimary }]}>{tr('Use this card')}</Text>
                    </Pressable>
                </KeyboardScroll>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    pad: { padding: 16, paddingBottom: 40 },
    secure: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 20 },
    secureTxt: { flex: 1, marginLeft: 10, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
    label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
    box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14 },
    input: { flex: 1, fontSize: 16, fontWeight: '700', paddingVertical: 14 },
    kind: { fontSize: 12.5, fontWeight: '800', marginLeft: 8 },
    err: { fontSize: 12, fontWeight: '600', marginTop: 5 },
    row: { flexDirection: 'row' },
    btn: { marginTop: 8, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
    btnTxt: { fontSize: 15.5, fontWeight: '800' },
});
