import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Image, Pressable, Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, radius, font } from '../../theme';
import { Button } from '../../components/ui';
import Icon from '../../components/Icon';
import { sendOtp, verifyOtp } from '../../api/authApi';
import { errMsg } from '../../api/adminClient';
import { useAuthStore } from '../../store/useAuthStore';

const PHONE_RE = /^[6-9]\d{9}$/;
const OTP_LENGTH = 6;
const EMPTY = Array.from({ length: OTP_LENGTH }, () => '');
const RESEND_SECONDS = 30;
const STEP_HEIGHT = 250;

const normalizePhone = (text) => {
    let d = String(text || '').replace(/\D/g, '');
    if (d.length > 10) {
        if (d.startsWith('91') && d.length >= 12) d = d.slice(2);
        else if (d.startsWith('0')) d = d.slice(1);
    }
    return d.slice(0, 10);
};

/*
 * One number decides everything: only a registered superadmin number receives an OTP and gets a panel.
 * Same flow and feel as the shop app's login, with a colour header instead of hero images, and no Skip
 * (every superadmin screen needs a login).
 */
export default function LoginScreen() {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const login = useAuthStore((s) => s.login);
    const notice = useAuthStore((s) => s.notice);
    const clearNotice = useAuthStore((s) => s.clearNotice);

    const [step, setStep] = useState('phone');   // phone | otp
    const [phone, setPhone] = useState('');
    const [digits, setDigits] = useState(EMPTY);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [wait, setWait] = useState(0);
    const [kbOpen, setKbOpen] = useState(false);

    const refs = useRef([]);
    const slide = useRef(new Animated.Value(0)).current;     // 0 = phone panel, 1 = otp panel
    const rise = useRef(new Animated.Value(0)).current;      // sheet entrance
    const shake = useRef(new Animated.Value(0)).current;
    const timer = useRef(null);

    const inner = width - spacing.xl * 2;
    const otp = digits.join('');

    useEffect(() => {
        Animated.timing(rise, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        const a = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
        const b = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
        return () => { a.remove(); b.remove(); clearInterval(timer.current); };
    }, [rise]);

    const goStep = (next) => {
        setStep(next);
        Animated.timing(slide, { toValue: next === 'otp' ? 1 : 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
            if (next === 'otp') refs.current[0]?.focus();
        });
    };

    const startWait = () => {
        clearInterval(timer.current);
        setWait(RESEND_SECONDS);
        timer.current = setInterval(() => setWait((w) => { if (w <= 1) { clearInterval(timer.current); return 0; } return w - 1; }), 1000);
    };

    const fail = (message) => {
        setError(message);
        shake.setValue(0);
        Animated.sequence([6, -6, 4, -4, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 60, useNativeDriver: true }))).start();
    };

    const send = async (isResend = false) => {
        if (!PHONE_RE.test(phone)) { fail('Enter a valid 10-digit mobile number'); return; }
        setBusy(true); setError(''); clearNotice();
        try {
            await sendOtp(phone);
            setDigits(EMPTY); startWait();
            if (!isResend) goStep('otp');
        } catch (e) { fail(errMsg(e)); } finally { setBusy(false); }
    };

    const verify = async (code) => {
        if (busy) return;
        if (code.length !== OTP_LENGTH) { fail('Enter the 6-digit code'); return; }
        setBusy(true); setError('');
        try {
            const r = await verifyOtp(phone, code);
            Keyboard.dismiss();
            await login(r.token, r.admin);
        } catch (e) {
            setDigits(EMPTY);
            refs.current[0]?.focus();
            fail(errMsg(e, 'Could not verify. Please try again.'));
            setBusy(false);
        }
    };

    /* ---- OTP boxes ---- */
    const setAt = (i, v) => setDigits((d) => d.map((x, k) => (k === i ? v : x)));
    const onDigit = (text, i) => {
        setError('');
        const clean = text.replace(/\D/g, '');
        if (!clean) { setAt(i, ''); return; }
        if (clean.length > 1) {   // paste or SMS autofill
            const chars = clean.slice(0, OTP_LENGTH).split('');
            const next = Array.from({ length: OTP_LENGTH }, (_, k) => chars[k] ?? '');
            setDigits(next);
            refs.current[Math.min(chars.length, OTP_LENGTH - 1)]?.focus();
            if (chars.length === OTP_LENGTH) verify(next.join(''));
            return;
        }
        setAt(i, clean);
        if (i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
        else {
            const next = digits.map((x, k) => (k === i ? clean : x));
            if (next.every(Boolean)) verify(next.join(''));
        }
    };
    const onKey = (e, i) => {
        if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) { setAt(i - 1, ''); refs.current[i - 1]?.focus(); }
    };

    const panelShift = slide.interpolate({ inputRange: [0, 1], outputRange: [0, -inner] });
    const riseY = rise.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });

    return (
        <View style={{ flex: 1, backgroundColor: t.gradient[1] }}>
            <StatusBar style="light" />
            <LinearGradient colors={t.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={[s.circle, { width: 300, height: 300, top: -90, right: -100 }]} />
            <View style={[s.circle, { width: 200, height: 200, top: 130, left: -90, opacity: 0.6 }]} />
            <View style={[s.circle, { width: 120, height: 120, top: 70, right: 60, opacity: 0.5 }]} />

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {/* brand */}
                <View style={[s.brand, { paddingTop: insets.top + spacing.xl }, kbOpen && { flex: 0, paddingBottom: spacing.lg }]}>
                    <View style={s.logoWrap}>
                        <Image source={require('../../../assets/icon.png')} style={{ width: kbOpen ? 64 : 96, height: kbOpen ? 64 : 96, borderRadius: kbOpen ? 18 : 28 }} />
                    </View>
                    {!kbOpen ? (
                        <>
                            <Text style={s.brandName}>Retail Control</Text>
                            <Text style={s.tagline}>Run every shop from one place</Text>
                        </>
                    ) : null}
                </View>

                {/* sheet */}
                <Animated.View
                    style={[
                        s.sheet,
                        { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, spacing.xl), transform: [{ translateY: riseY }], opacity: rise },
                    ]}
                >
                    {notice ? (
                        <View style={{ backgroundColor: t.warnSoft, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md }}>
                            <Text style={{ color: t.warn, fontWeight: '700' }}>{notice}</Text>
                        </View>
                    ) : null}

                    <View style={{ height: STEP_HEIGHT, overflow: 'hidden' }}>
                        <Animated.View style={{ flexDirection: 'row', width: inner * 2, transform: [{ translateX: panelShift }] }}>
                            {/* step 1: phone */}
                            <View style={{ width: inner }}>
                                <Text style={[s.h1, { color: t.text }]}>Welcome back</Text>
                                <Text style={[s.sub, { color: t.muted }]}>Sign in with your registered mobile number</Text>

                                <Animated.View style={{ transform: [{ translateX: step === 'phone' ? shake : 0 }] }}>
                                    <View style={[s.phoneRow, { borderColor: error && step === 'phone' ? t.danger : t.border, backgroundColor: t.bg }]}>
                                        <View style={[s.cc, { backgroundColor: t.primarySoft }]}>
                                            <Text style={{ color: t.primary, fontWeight: '800', fontSize: font.md }}>+91</Text>
                                        </View>
                                        <TextInput
                                            value={phone}
                                            onChangeText={(v) => { setPhone(normalizePhone(v)); setError(''); }}
                                            keyboardType="number-pad"
                                            autoComplete="tel-national"
                                            importantForAutofill="yes"
                                            placeholder="10-digit mobile number"
                                            placeholderTextColor={t.muted}
                                            maxLength={14}
                                            style={{ flex: 1, color: t.text, fontSize: font.lg, fontWeight: '600', paddingHorizontal: spacing.md }}
                                            returnKeyType="done"
                                            onSubmitEditing={() => send(false)}
                                        />
                                    </View>
                                </Animated.View>
                                <Text style={[s.err, { color: t.danger }]}>{step === 'phone' ? error : ' '}</Text>

                                <Button title="Get OTP" onPress={() => send(false)} loading={busy && step === 'phone'} disabled={phone.length !== 10} />
                            </View>

                            {/* step 2: otp */}
                            <View style={{ width: inner }}>
                                <Text style={[s.h1, { color: t.text }]}>Verify OTP</Text>
                                <Pressable onPress={() => { setError(''); goStep('phone'); }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }}>
                                    <Text style={{ color: t.muted, fontSize: font.md }}>Sent to +91 {phone}  </Text>
                                    <Icon name="edit" size={16} color={t.primary} />
                                </Pressable>

                                <Animated.View style={[s.otpRow, { transform: [{ translateX: step === 'otp' ? shake : 0 }] }]}>
                                    {digits.map((d, i) => (
                                        <TextInput
                                            key={i}
                                            ref={(r) => { refs.current[i] = r; }}
                                            value={d}
                                            onChangeText={(v) => onDigit(v, i)}
                                            onKeyPress={(e) => onKey(e, i)}
                                            keyboardType="number-pad"
                                            maxLength={i === 0 ? OTP_LENGTH : 1}
                                            textContentType="oneTimeCode"
                                            autoComplete={i === 0 ? 'sms-otp' : 'off'}
                                            importantForAutofill={i === 0 ? 'yes' : 'no'}
                                            selectTextOnFocus
                                            style={[
                                                s.box,
                                                { color: t.text, backgroundColor: t.bg, borderColor: error && step === 'otp' ? t.danger : d ? t.primary : t.border },
                                            ]}
                                        />
                                    ))}
                                </Animated.View>
                                <Text style={[s.err, { color: t.danger }]}>{step === 'otp' ? error : ' '}</Text>

                                <Button title="Verify and continue" onPress={() => verify(otp)} loading={busy && step === 'otp'} disabled={otp.length !== OTP_LENGTH} />
                                <Pressable onPress={wait ? undefined : () => send(true)} hitSlop={10} style={{ alignSelf: 'center', marginTop: spacing.md }}>
                                    <Text style={{ color: wait ? t.muted : t.primary, fontWeight: '700' }}>{wait ? `Resend code in ${wait}s` : 'Resend code'}</Text>
                                </Pressable>
                            </View>
                        </Animated.View>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg }}>
                        <Icon name="lock" size={14} color={t.muted} />
                        <Text style={{ color: t.muted, fontSize: font.xs, marginLeft: 6 }}>Only registered superadmin numbers can sign in</Text>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
    brand: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    logoWrap: {
        padding: 6, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.28)',
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8,
    },
    brandName: { color: '#FFFFFF', fontSize: font.hero, fontWeight: '800', marginTop: spacing.lg, letterSpacing: 0.3 },
    tagline: { color: 'rgba(255,255,255,0.85)', fontSize: font.md, marginTop: 4 },
    sheet: {
        borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
        shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 16,
    },
    h1: { fontSize: font.xl + 2, fontWeight: '800' },
    sub: { fontSize: font.md, marginTop: 4, marginBottom: spacing.lg },
    phoneRow: { flexDirection: 'row', alignItems: 'center', height: 58, borderRadius: radius.lg, borderWidth: 1.5, padding: 6 },
    cc: { height: '100%', paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    err: { fontSize: font.sm, fontWeight: '600', height: 28, paddingTop: 6 },
    otpRow: { flexDirection: 'row', justifyContent: 'space-between' },
    box: { width: 46, height: 56, borderRadius: radius.md, borderWidth: 1.5, textAlign: 'center', fontSize: 22, fontWeight: '800' },
});
