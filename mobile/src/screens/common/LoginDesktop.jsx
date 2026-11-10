// The login screen of the DESKTOP website (a browser at least 1024 px wide). Phones, the phone browser, tablets and the native app keep the
// original LoginScreen untouched: LoginScreen picks this one only on a wide web window (utils/common/layout.js).
// Left: the shop's pictures, big. Right: the form in a calm card. The same calls as the phone screen: send-otp, verify-otp, then the app opens.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api/common/client';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useBrand } from '../../components/common/kit';
import { ActivityIndicator } from '../../components/common/Loading';
import PoweredBy from '../../components/common/PoweredBy';
import LanguageSheet from '../../components/common/LanguageSheet';
import { tr, LANGS, useLang } from '../../i18n';

const MAIN_ROUTE = 'MainTabs';
const OTP_LENGTH = 6;
const EMPTY = Array.from({ length: OTP_LENGTH }, () => '');
const RESEND_SECONDS = 30;
const HERO_MS = 5500;
const noOutline = { outlineStyle: 'none', outlineWidth: 0 };   // the browser's own focus box: the field draws its own

const normalizePhone = (text) => {
    let d = String(text || '').replace(/\D/g, '');
    if (d.length > 10) {
        if (d.startsWith('91') && d.length >= 12) d = d.slice(2);
        else if (d.startsWith('0')) d = d.slice(1);
    }
    return d.slice(0, 10);
};

function OtpRow({ digits, setDigits, refs, hasError, dimmed, onEdit, c }) {
    const [focus, setFocus] = useState(-1);
    const go = (i) => refs.current[i]?.focus();
    const change = (text, i) => {
        onEdit();
        const clean = String(text || '').replace(/\D/g, '');
        if (!clean) { setDigits((d) => d.map((v, k) => (k === i ? '' : v))); return; }
        if (clean.length > 1) {   // pasted: fill from this box
            const chars = clean.slice(0, OTP_LENGTH - i).split('');
            setDigits((d) => d.map((v, k) => (k >= i && k - i < chars.length ? chars[k - i] : v)));
            go(Math.min(i + chars.length, OTP_LENGTH - 1));
            return;
        }
        setDigits((d) => d.map((v, k) => (k === i ? clean : v)));
        if (i < OTP_LENGTH - 1) go(i + 1);
    };
    const key = (e, i) => {
        if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
            setDigits((d) => d.map((v, k) => (k === i - 1 ? '' : v)));
            go(i - 1);
        }
    };
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: dimmed ? 0.5 : 1 }}>
            {digits.map((d, i) => (
                <TextInput
                    key={i}
                    ref={(r) => { refs.current[i] = r; }}
                    value={d}
                    onChangeText={(t) => change(t, i)}
                    onKeyPress={(e) => key(e, i)}
                    onFocus={() => setFocus(i)}
                    onBlur={() => setFocus((f) => (f === i ? -1 : f))}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    editable={!dimmed}
                    selectTextOnFocus
                    style={[s.otpBox, noOutline, {
                        color: c.text, backgroundColor: c.bg,
                        borderColor: hasError ? c.error : focus === i || d ? c.primary : c.border,
                    }]}
                />
            ))}
        </View>
    );
}

export default function LoginDesktop({ navigation }) {
    const brand = useBrand();
    const { theme } = useThemeStore();
    const loginStore = useAuthStore((st) => st.login);
    const lang = useLang((st) => st.lang);
    const [langOpen, setLangOpen] = useState(false);

    const brandName = theme?.name || 'Delivery';
    const tagline = theme?.tagline || 'Delicious food, delivered to your door';
    const heroes = theme?.heroImages || [];
    const [heroIdx, setHeroIdx] = useState(0);
    useEffect(() => {
        if (heroes.length < 2) return undefined;
        const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroes.length), HERO_MS);
        return () => clearInterval(t);
    }, [heroes.length]);

    const [step, setStep] = useState('phone');
    const [phone, setPhone] = useState('');
    const [digits, setDigits] = useState(EMPTY);
    const [phoneFocus, setPhoneFocus] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [secondsLeft, setSecondsLeft] = useState(0);
    const phoneRef = useRef(null);
    const otpRefs = useRef([]);
    const verifying = useRef(false);

    useEffect(() => { const t = setTimeout(() => phoneRef.current?.focus(), 300); return () => clearTimeout(t); }, []);
    useEffect(() => {
        if (secondsLeft <= 0) return undefined;
        const t = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
        return () => clearTimeout(t);
    }, [secondsLeft]);

    const goToMain = useCallback(() => {
        let nav = navigation;
        while (nav) {
            if (nav.getState?.()?.routeNames?.includes(MAIN_ROUTE)) { nav.reset({ index: 0, routes: [{ name: MAIN_ROUTE }] }); return; }
            nav = nav.getParent?.();
        }
    }, [navigation]);

    const sendOtp = useCallback(async () => {
        if (phone.length !== 10 || loading) return;
        setError(''); setLoading(true); setDigits(EMPTY);
        try {
            await api.post('/auth/send-otp', { phone });
            setSecondsLeft(RESEND_SECONDS);
            setStep('otp');
            setTimeout(() => otpRefs.current[0]?.focus(), 120);
        } catch (e) {
            setError(e.response?.data?.error || tr('Could not send OTP. Please try again.'));
        } finally { setLoading(false); }
    }, [phone, loading]);

    const verifyOtp = useCallback(async (code) => {
        if (verifying.current) return;
        verifying.current = true; setError(''); setLoading(true);
        try {
            const { data } = await api.post('/auth/verify-otp', { phone, otp: code });
            await loginStore(data.user, data.accessToken, data.refreshToken);
            goToMain();
        } catch (e) {
            setError(e.response?.data?.error || tr('Incorrect OTP. Please try again.'));
            setDigits(EMPTY);
            setTimeout(() => otpRefs.current[0]?.focus(), 80);
        } finally { verifying.current = false; setLoading(false); }
    }, [phone, goToMain, loginStore]);

    const otp = digits.join('');
    useEffect(() => { if (step === 'otp' && otp.length === OTP_LENGTH) verifyOtp(otp); }, [otp, step, verifyOtp]);

    const resend = async () => {
        if (secondsLeft > 0 || loading) return;
        setError(''); setDigits(EMPTY);
        try { await api.post('/auth/send-otp', { phone }); setSecondsLeft(RESEND_SECONDS); otpRefs.current[0]?.focus(); }
        catch (e) { setError(e.response?.data?.error || tr('Could not resend OTP.')); }
    };
    const changeNumber = () => { setError(''); setDigits(EMPTY); setStep('phone'); setTimeout(() => phoneRef.current?.focus(), 80); };

    const ready = phone.length === 10 && !loading;
    const c = { primary: brand.primary, error: brand.errorText || brand.error, text: brand.text, bg: brand.background, border: brand.border };

    return (
        <View style={[s.root, { backgroundColor: brand.background }]}>
            {/* LEFT: the shop */}
            <View style={s.left}>
                {heroes.length === 0 ? (
                    <LinearGradient colors={[brand.primaryLight, brand.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                ) : (
                    <Image source={heroes[heroIdx % heroes.length]} style={StyleSheet.absoluteFill} contentFit="cover" transition={900} cachePolicy="memory-disk" />
                )}
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
                <View style={s.leftText}>
                    <Text style={s.heroName} numberOfLines={2}>{brandName}</Text>
                    <Text style={s.heroTag} numberOfLines={3}>{tagline}</Text>
                    {heroes.length > 1 ? (
                        <View style={s.dots}>
                            {heroes.map((_, i) => <View key={i} style={[s.dot, i === heroIdx % heroes.length && s.dotOn]} />)}
                        </View>
                    ) : null}
                </View>
            </View>

            {/* RIGHT: the form */}
            <View style={[s.right, { backgroundColor: brand.surface }]}>
                <View style={s.topBar}>
                    <Pressable onPress={() => setLangOpen(true)} style={[s.chip, { borderColor: brand.border }]}>
                        <Ionicons name="language" size={15} color={brand.text} style={{ marginRight: 6 }} />
                        <Text style={{ color: brand.text, fontWeight: '700', fontSize: 13 }}>{LANGS.find((l) => l.code === lang)?.native}</Text>
                    </Pressable>
                    <Pressable onPress={goToMain} style={[s.chip, { borderColor: brand.border }]}>
                        <Text style={{ color: brand.text, fontWeight: '700', fontSize: 13 }}>{tr('Skip')}</Text>
                    </Pressable>
                </View>

                <ScrollView contentContainerStyle={s.formWrap} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={s.card}>
                        <Text style={[s.welcome, { color: brand.text }]}>{step === 'phone' ? tr('Log in or sign up') : tr('Verify your number')}</Text>
                        <Text style={[s.sub, { color: brand.muted }]}>
                            {step === 'phone'
                                ? tr('Enter your phone number and we will send you a code.')
                                : `${tr('Enter the')} ${OTP_LENGTH}${tr('-digit code sent to')} +91 ${phone.slice(0, 5)} ${phone.slice(5)}`}
                        </Text>

                        {step === 'phone' ? (
                            <>
                                <View style={[s.inputRow, { borderColor: phoneFocus || phone ? brand.primary : brand.border, backgroundColor: brand.background }]}>
                                    <Text style={s.flag}>🇮🇳</Text>
                                    <Text style={[s.cc, { color: brand.text }]}>+91</Text>
                                    <View style={[s.vline, { backgroundColor: brand.border }]} />
                                    <TextInput
                                        ref={phoneRef}
                                        style={[s.phoneInput, noOutline, { color: brand.text }]}
                                        keyboardType="phone-pad"
                                        inputMode="tel"
                                        autoComplete="tel-national"
                                        placeholder={tr('Enter phone number')}
                                        placeholderTextColor={brand.muted}
                                        value={phone}
                                        onChangeText={(t) => { setError(''); setPhone(normalizePhone(t)); }}
                                        onFocus={() => setPhoneFocus(true)}
                                        onBlur={() => setPhoneFocus(false)}
                                        onSubmitEditing={sendOtp}
                                        maxLength={14}
                                    />
                                    {phone ? (
                                        <Pressable onPress={() => { setPhone(''); phoneRef.current?.focus(); }} hitSlop={10}>
                                            <Text style={{ color: brand.muted, fontSize: 16 }}>✕</Text>
                                        </Pressable>
                                    ) : null}
                                </View>

                                <Pressable onPress={sendOtp} disabled={!ready} style={[s.btnWrap, { opacity: ready || loading ? 1 : 0.45 }]}>
                                    <LinearGradient colors={[brand.primaryLight, brand.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btn}>
                                        {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnText}>{tr('Continue')}</Text>}
                                    </LinearGradient>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <OtpRow digits={digits} setDigits={setDigits} refs={otpRefs} hasError={!!error} dimmed={loading} onEdit={() => setError('')} c={c} />
                                {!error && loading ? <Text style={{ color: brand.muted, marginTop: 16 }}>{tr('Verifying...')}</Text> : null}
                                {!loading ? (
                                    <View style={s.otpFooter}>
                                        <Pressable onPress={changeNumber} hitSlop={10}><Text style={[s.link, { color: brand.primary }]}>{tr('Change number')}</Text></Pressable>
                                        <Pressable onPress={resend} disabled={secondsLeft > 0} hitSlop={10}>
                                            <Text style={[s.link, { color: secondsLeft > 0 ? brand.muted : brand.primary }]}>
                                                {secondsLeft > 0 ? tr('Resend in 0:{v1}', { v1: String(secondsLeft).padStart(2, '0') }) : tr('Resend OTP')}
                                            </Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </>
                        )}

                        {!!error && <Text style={[s.err, { color: c.error }]}>{error}</Text>}

                        <Text style={[s.terms, { color: brand.muted }]}>
                            {tr('By continuing, you agree to our')}{' '}
                            <Text onPress={() => navigation.navigate('LegalDoc', { key: 'customer_terms', pub: true })} style={[s.termsLink, { color: brand.text }]}>{tr('Terms of Service')}</Text>
                            {'  '}
                            <Text onPress={() => navigation.navigate('LegalDoc', { key: 'privacy', pub: true })} style={[s.termsLink, { color: brand.text }]}>{tr('Privacy Policy')}</Text>
                        </Text>
                    </View>
                </ScrollView>
                <PoweredBy />
            </View>
            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    left: { flex: 1.25, backgroundColor: '#161616', overflow: 'hidden', justifyContent: 'flex-end' },
    leftText: { padding: 56, paddingBottom: 64 },
    heroName: { color: '#FFFFFF', fontSize: 54, lineHeight: 60, fontWeight: '900', letterSpacing: -0.5 },
    heroTag: { color: 'rgba(255,255,255,0.88)', fontSize: 20, lineHeight: 28, marginTop: 14, maxWidth: 520 },
    dots: { flexDirection: 'row', marginTop: 28 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)', marginRight: 8 },
    dotOn: { width: 26, backgroundColor: '#FFFFFF' },
    right: { flex: 1, minWidth: 480, maxWidth: 720 },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 32, paddingTop: 24 },
    chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
    formWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 24 },
    card: { width: '100%', maxWidth: 400 },
    welcome: { fontSize: 30, lineHeight: 38, fontWeight: '900', letterSpacing: -0.3 },
    sub: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 28 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 58 },
    flag: { fontSize: 20, marginRight: 8 },
    cc: { fontSize: 16, fontWeight: '700' },
    vline: { width: 1, height: 24, marginHorizontal: 12 },
    phoneInput: { flex: 1, fontSize: 17, fontWeight: '600', height: '100%' },
    btnWrap: { marginTop: 18, borderRadius: 14, overflow: 'hidden', cursor: 'pointer' },
    btn: { height: 54, alignItems: 'center', justifyContent: 'center' },
    btnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
    otpBox: { width: 52, height: 60, borderWidth: 1.5, borderRadius: 12, textAlign: 'center', fontSize: 24, fontWeight: '800' },
    otpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
    link: { fontSize: 14, fontWeight: '700' },
    err: { fontSize: 14, marginTop: 16, fontWeight: '600' },
    terms: { fontSize: 12.5, lineHeight: 19, marginTop: 28 },
    termsLink: { fontWeight: '700', textDecorationLine: 'underline' },
});
