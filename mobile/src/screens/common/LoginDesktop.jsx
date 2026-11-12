// The login screen of the DESKTOP website (a browser at least 1024 px wide). Phones, the phone browser, tablets and the native app keep the
// original LoginScreen untouched: LoginScreen picks this one only on a wide web window (utils/common/layout.js).
// Left: the shop's pictures, big. Right: the form in a calm card. The same calls as the phone screen: send-otp, verify-otp, then the app opens.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api/common/client';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { ActivityIndicator } from '../../components/common/Loading';
import { LineShimmer } from '../../components/owners/shimmer';
import PoweredBy from '../../components/common/PoweredBy';
import IndiaFlag from '../../components/common/IndiaFlag';
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

// The desktop login is always dark (the design asked for it), whatever the shop's own colours are.
// The wallpaper of the right side comes from the CDN: theme.loginBg (the superadmin picks it per shop, else the default of the shop's business type). Nothing is bundled.
const D = { bg: '#121212', card: '#262626', input: '#171717', border: '#404040', text: '#FFFFFF', muted: '#A3A3A3', accent: '#B91C1C', accentText: '#F87171', error: '#F87171' };


// "Language" as a centred dark modal (the phone screens use a bottom sheet).
function DesktopLanguageModal({ visible, onClose }) {
    const lang = useLang((st) => st.lang);
    const setLanguage = useLang((st) => st.setLanguage);
    const pick = async (code) => { onClose(); if (code !== lang) await setLanguage(code); };
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={s.backdrop} onPress={onClose}>
                <Pressable style={s.modal} onPress={() => {}}>
                    <View style={s.modalHead}>
                        <View style={{ flex: 1 }}>
                            <Text style={s.modalTitle}>{tr('Language')}</Text>
                            <Text style={s.modalSub}>{tr('Choose the language of the app')}</Text>
                        </View>
                        <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}><Ionicons name="close" size={22} color={D.muted} /></Pressable>
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {LANGS.map((l) => {
                            const on = lang === l.code;
                            return (
                                <Pressable key={l.code} onPress={() => pick(l.code)} style={[s.langRow, on && s.langRowOn]}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.langNative}>{l.native}</Text>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                            <Text style={s.langName}>{l.name}</Text>
                                            {l.beta ? <View style={s.beta}><Text style={s.betaText}>BETA</Text></View> : null}
                                        </View>
                                    </View>
                                    <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? D.accent : '#525252'} />
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

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
    const { theme } = useThemeStore();
    const loginStore = useAuthStore((st) => st.login);
    const lang = useLang((st) => st.lang);
    const [langOpen, setLangOpen] = useState(false);

    const loginBgSource = theme?.loginBg ? { uri: theme.loginBg } : null;   // none = the plain dark background
    const brandName = theme?.name || 'Delivery';
    const tagline = theme?.tagline || 'Delicious food, delivered to your door';
    const heroes = theme?.heroImages || [];
    const logoUri = theme?.icon || theme?.logo || null;   // the shop's own logo, as a small mark on its picture
    const [heroIdx, setHeroIdx] = useState(0);
    const heroCount = heroes.length;
    useEffect(() => {   // auto-advance; restarts after every change (a click or a swipe) so it never jumps right after one
        if (heroCount < 2) return undefined;
        const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroCount), HERO_MS);
        return () => clearInterval(t);
    }, [heroCount, heroIdx]);

    // Two-finger swipe on the trackpad = sideways wheel events. One swipe moves ONE picture (the trackpad keeps sending events after the
    // fingers lift, so we wait a moment before listening again). Native listener: the page's own "swipe = go back" must be blocked.
    const leftRef = useRef(null);
    useEffect(() => {
        const el = leftRef.current;
        if (!el || heroCount < 2 || !el.addEventListener) return undefined;
        let acc = 0; let lockUntil = 0;
        const onWheel = (e) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // an up/down scroll is not a swipe
            e.preventDefault();
            const now = Date.now();
            if (now < lockUntil) return;
            acc += e.deltaX;
            if (Math.abs(acc) < 50) return;
            setHeroIdx((i) => (acc > 0 ? (i + 1) % heroCount : (i - 1 + heroCount) % heroCount));
            acc = 0; lockUntil = now + 700;
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [heroCount]);

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
    const c = { primary: D.accent, error: D.error, text: D.text, bg: D.input, border: D.border };

    return (
        <View style={[s.root, { backgroundColor: D.bg }]}>
            {/* LEFT: the shop (half the screen) */}
            <View style={s.left} ref={leftRef}>
                {heroes.length === 0 ? (
                    <>
                        <LinearGradient colors={['#5a1212', '#151515']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                        {loginBgSource ? <ImageBackground pointerEvents="none" source={loginBgSource} resizeMode="cover" imageStyle={{ opacity: 0.55 }} style={StyleSheet.absoluteFill} /> : null}
                    </>
                ) : (
                    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.kenBurns]}>
                        <Image source={heroes[heroIdx % heroes.length]} style={StyleSheet.absoluteFill} contentFit="cover" transition={900} cachePolicy="memory-disk" />
                    </View>
                )}
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.92)']} locations={[0, 0.5, 1]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} locations={[0, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.topFade} />
                {logoUri ? (
                    <View style={s.logoMark}>
                        <Image source={logoUri} style={{ width: 52, height: 52, borderRadius: 14 }} contentFit="cover" />
                    </View>
                ) : null}
                <View style={s.leftText}>
                    <View style={s.accentBar} />
                    <Text style={s.heroName} numberOfLines={3}>{brandName}</Text>
                    <Text style={s.heroTag} numberOfLines={3}>{tagline}</Text>
                    {heroes.length > 1 ? (
                        <View style={s.dots}>
                            {heroes.map((_, i) => (
                                <Pressable key={i} onPress={() => setHeroIdx(i)} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }} style={s.dotHit}>
                                    <View style={[s.dot, i === heroIdx % heroes.length && s.dotOn]} />
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                </View>
            </View>

            {/* RIGHT: the form */}
            <View style={[s.right, { backgroundColor: D.bg }]}>
                {/* the wallpaper of food drawings, filling this side; a soft dark spot keeps the middle calm behind the form */}
                {loginBgSource ? <ImageBackground pointerEvents="none" source={loginBgSource} resizeMode="cover" imageStyle={{ opacity: 0.9 }} style={StyleSheet.absoluteFill} /> : null}
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundImage: 'radial-gradient(closest-side at 50% 52%, rgba(18,18,18,0.8) 0%, rgba(18,18,18,0.4) 55%, rgba(18,18,18,0) 100%)' }]} />
                <View style={s.topBar}>
                    <Pressable onPress={() => setLangOpen(true)} style={({ hovered }) => [s.chip, hovered && s.chipHover]}>
                        <Text style={s.chipIcon}>A/文</Text>
                        <Text style={s.chipText}>{LANGS.find((l) => l.code === lang)?.native}</Text>
                        <Ionicons name="chevron-down" size={14} color={D.text} style={{ marginLeft: 6 }} />
                    </Pressable>
                    <Pressable onPress={goToMain} style={({ hovered }) => [s.chip, hovered && s.chipHover]}>
                        <Text style={s.chipText}>{tr('Skip')}</Text>
                    </Pressable>
                </View>

                <ScrollView contentContainerStyle={s.formWrap} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={s.card}>
                        <View style={s.headRow}>
                            <View style={s.headLine} />
                            <Text style={s.headText}>{step === 'phone' ? tr('Log in or sign up') : tr('Verify your number')}</Text>
                            <View style={s.headLine} />
                        </View>
                        {step === 'otp' ? (
                            <Text style={s.sub}>{`${tr('Enter the')} ${OTP_LENGTH}${tr('-digit code sent to')} +91 ${phone.slice(0, 5)} ${phone.slice(5)}`}</Text>
                        ) : null}

                        {step === 'phone' ? (
                            <>
                                <View style={[s.inputRow, { borderColor: phoneFocus ? D.accent : D.border }]}>
                                    <IndiaFlag style={{ marginRight: 10 }} />
                                    <Text style={s.cc}>+91</Text>
                                    <View style={s.vline} />
                                    <TextInput
                                        ref={phoneRef}
                                        style={[s.phoneInput, noOutline]}
                                        keyboardType="phone-pad"
                                        inputMode="tel"
                                        autoComplete="tel-national"
                                        placeholder={tr('Enter phone number')}
                                        placeholderTextColor={D.muted}
                                        value={phone}
                                        onChangeText={(t) => { setError(''); setPhone(normalizePhone(t)); }}
                                        onFocus={() => setPhoneFocus(true)}
                                        onBlur={() => setPhoneFocus(false)}
                                        onSubmitEditing={sendOtp}
                                        maxLength={14}
                                    />
                                    {phone ? (
                                        <Pressable onPress={() => { setPhone(''); phoneRef.current?.focus(); }} hitSlop={10}>
                                            <Text style={{ color: D.muted, fontSize: 16 }}>✕</Text>
                                        </Pressable>
                                    ) : null}
                                </View>

                                <Pressable onPress={sendOtp} disabled={!ready} style={({ hovered }) => [s.btn, { opacity: ready || loading ? 1 : 0.5 }, hovered && ready && s.btnHover]}>
                                    {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.btnText}>{tr('Continue')}</Text>}
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <OtpRow digits={digits} setDigits={setDigits} refs={otpRefs} hasError={!!error} dimmed={loading} onEdit={() => setError('')} c={c} />
                                {!error && loading ? <View style={{ marginTop: 18, alignItems: 'center' }}><LineShimmer width={160} height={16} /></View> : null}
                                {!loading ? (
                                    <View style={s.otpFooter}>
                                        <Pressable onPress={changeNumber} hitSlop={10}><Text style={[s.link, { color: D.accentText }]}>{tr('Change number')}</Text></Pressable>
                                        <Pressable onPress={resend} disabled={secondsLeft > 0} hitSlop={10}>
                                            <Text style={[s.link, { color: secondsLeft > 0 ? D.muted : D.accentText }]}>
                                                {secondsLeft > 0 ? tr('Resend in 0:{v1}', { v1: String(secondsLeft).padStart(2, '0') }) : tr('Resend OTP')}
                                            </Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </>
                        )}

                        {!!error && <Text style={[s.err, { color: D.error }]}>{error}</Text>}

                        <Text style={s.terms}>
                            {tr('By continuing, you agree to our')}{' '}
                            <Text onPress={() => navigation.navigate('Terms')} style={s.termsLink}>{tr('Terms of Service')}</Text>
                            {' & '}
                            <Text onPress={() => navigation.navigate('Privacy')} style={s.termsLink}>{tr('Privacy Policy')}</Text>
                        </Text>
                    </View>
                </ScrollView>
                <PoweredBy />
            </View>
            <DesktopLanguageModal visible={langOpen} onClose={() => setLangOpen(false)} />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    left: { flex: 1, backgroundColor: '#161616', overflow: 'hidden', justifyContent: 'flex-end' },
    leftText: { padding: 56, paddingBottom: 64 },
    kenBurns: { animationKeyframes: { '0%': { transform: [{ scale: 1 }] }, '100%': { transform: [{ scale: 1.08 }] } }, animationDuration: '16s', animationIterationCount: 'infinite', animationDirection: 'alternate', animationTimingFunction: 'ease-in-out' },
    topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
    logoMark: { position: 'absolute', top: 40, left: 56, padding: 5, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backdropFilter: 'blur(10px)' },
    accentBar: { width: 56, height: 6, borderRadius: 3, backgroundColor: D.accent, marginBottom: 22, boxShadow: '0 0 24px rgba(185,28,28,0.7)' },
    heroName: { color: '#FFFFFF', fontSize: 60, lineHeight: 66, fontWeight: '900', letterSpacing: -0.8 },
    heroTag: { color: 'rgba(255,255,255,0.85)', fontSize: 21, lineHeight: 30, marginTop: 14, maxWidth: 520 },
    dots: { flexDirection: 'row', marginTop: 30 },
    dotHit: { cursor: 'pointer', marginRight: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
    dotOn: { width: 26, backgroundColor: '#FFFFFF' },
    right: { flex: 1 },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 32, paddingTop: 24, zIndex: 2 },
    chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#4B4B4B', backgroundColor: 'rgba(20,20,20,0.94)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', transitionProperty: 'background-color, border-color', transitionDuration: '150ms' },
    chipHover: { backgroundColor: '#2A2A2A', borderColor: '#6B6B6B' },
    chipIcon: { color: D.muted, fontSize: 12, fontWeight: '800', marginRight: 8 },
    chipText: { color: D.text, fontWeight: '700', fontSize: 13.5 },
    formWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 24 },
    card: {
        width: '100%', maxWidth: 440, backgroundColor: D.card, borderRadius: 20, borderWidth: 1, borderColor: D.border, padding: 36,
        boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
    },
    headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
    headLine: { flex: 1, height: 1, backgroundColor: D.border },
    headText: { color: D.text, fontSize: 15, fontWeight: '700', marginHorizontal: 14 },
    sub: { color: D.muted, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: -10, marginBottom: 24 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, height: 56, backgroundColor: D.input },
    cc: { color: D.text, fontSize: 16, fontWeight: '700' },
    vline: { width: 1, height: 24, marginHorizontal: 12, backgroundColor: D.border },
    phoneInput: { flex: 1, fontSize: 16.5, fontWeight: '600', height: '100%', color: D.text },
    btn: { marginTop: 20, height: 54, borderRadius: 999, backgroundColor: D.accent, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
    btnHover: { backgroundColor: '#991B1B' },
    btnText: { color: '#FFFFFF', fontSize: 16.5, fontWeight: '800' },
    otpBox: { width: 52, height: 60, borderWidth: 1.5, borderRadius: 12, textAlign: 'center', fontSize: 24, fontWeight: '800' },
    otpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
    link: { fontSize: 14, fontWeight: '700' },
    err: { fontSize: 14, marginTop: 16, fontWeight: '600', textAlign: 'center' },
    terms: { color: D.muted, fontSize: 12, lineHeight: 18, marginTop: 26, textAlign: 'center' },
    termsLink: { color: D.text, fontWeight: '800' },
    // language modal
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(6px)' },
    modal: { width: '100%', maxWidth: 480, maxHeight: '90%', backgroundColor: D.card, borderRadius: 20, borderWidth: 1, borderColor: D.border, padding: 26, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' },
    modalHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
    modalTitle: { color: D.text, fontSize: 22, fontWeight: '900' },
    modalSub: { color: D.muted, fontSize: 13.5, marginTop: 3 },
    closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
    langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: D.border, backgroundColor: D.input, cursor: 'pointer' },
    langRowOn: { borderWidth: 1.5, borderColor: D.accent, backgroundColor: 'rgba(185,28,28,0.1)' },
    langNative: { color: D.text, fontSize: 17, fontWeight: '800' },
    langName: { color: D.muted, fontSize: 12.5, fontWeight: '600' },
    beta: { marginLeft: 8, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, backgroundColor: 'rgba(185,28,28,0.2)' },
    betaText: { color: D.accentText, fontSize: 10, fontWeight: '800' },
});
