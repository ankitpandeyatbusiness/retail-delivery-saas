// src/screens/LoginScreen.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Keyboard,
    Pressable,
    ActivityIndicator,
    BackHandler,
    Platform,
    StatusBar,
    useWindowDimensions,
} from 'react-native';
import api from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import Animated, {
    Easing,
    Extrapolation,
    FadeInDown,
    interpolate,
    useAnimatedKeyboard,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useThemeStore } from '../store/useThemeStore';

// Native SMS helpers are optional
let SmsRetriever = null;
let OtpVerify = null;
if (Platform.OS === 'android') {
    try {
        SmsRetriever = require('react-native-sms-retriever').default;
    } catch (e) { }
    try {
        OtpVerify = require('react-native-otp-verify');
    } catch (e) { }
}

const MAIN_ROUTE = 'MainTabs';
const OTP_LENGTH = 6;
const EMPTY_DIGITS = Array.from({ length: OTP_LENGTH }, () => '');
const RESEND_SECONDS = 30;
const STEP_HEIGHT = 176;
const HERO_INTERVAL = 3800;

const normalizePhone = (text) => {
    let d = String(text || '').replace(/\D/g, '');
    if (d.length > 10) {
        if (d.startsWith('91') && d.length >= 12) d = d.slice(2);
        else if (d.startsWith('0')) d = d.slice(1);
    }
    return d.slice(0, 10);
};

/* ----------------------------- small components ---------------------------- */

function PrimaryButton({ title, onPress, disabled, loading, colors }) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <Animated.View style={animatedStyle}>
            <Pressable
                onPress={onPress}
                disabled={disabled || loading}
                onPressIn={() => (scale.value = withSpring(0.97, { damping: 15, stiffness: 300 }))}
                onPressOut={() => (scale.value = withSpring(1, { damping: 15, stiffness: 300 }))}
                style={[styles.buttonWrap, { opacity: disabled ? 0.45 : 1 }]}
            >
                <LinearGradient colors={colors} style={styles.button}>
                    {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : (
                        <Text style={styles.buttonText}>{title}</Text>
                    )}
                </LinearGradient>
            </Pressable>
        </Animated.View>
    );
}

function Dot({ index, scrollX, width, heroCount, heroLoop }) {
    const style = useAnimatedStyle(() => {
        const n = heroCount;
        const pos = heroLoop ? scrollX.value / width - 1 : scrollX.value / width;
        const p = ((pos % n) + n) % n;
        let dist = Math.abs(p - index);
        dist = Math.min(dist, n - dist);
        return {
            width: interpolate(dist, [0, 1], [24, 8], Extrapolation.CLAMP),
            opacity: interpolate(dist, [0, 1], [1, 0.45], Extrapolation.CLAMP),
        };
    });
    return <Animated.View style={[styles.dot, style]} />;
}

function OtpBoxes({ digits, setDigits, inputRefs, hasError, dimmed, onEdit, colors }) {
    const [focused, setFocused] = useState(0);

    const focusBox = (i) => inputRefs.current[i]?.focus();
    const setAt = (i, value) => setDigits((d) => d.map((v, k) => (k === i ? value : v)));

    const handleChange = (text, i) => {
        onEdit?.();
        const clean = text.replace(/\D/g, '');

        if (!clean) {
            setAt(i, '');
            return;
        }
        if (clean.length === 2 && digits[i]) {
            setAt(i, clean.replace(digits[i], '') || clean[1]);
            if (i < OTP_LENGTH - 1) focusBox(i + 1);
            return;
        }
        if (clean.length > 1) {
            const chars = clean.slice(0, OTP_LENGTH).split('');
            setDigits(Array.from({ length: OTP_LENGTH }, (_, k) => chars[k] ?? ''));
            focusBox(Math.min(chars.length, OTP_LENGTH - 1));
            return;
        }
        setAt(i, clean);
        if (i < OTP_LENGTH - 1) focusBox(i + 1);
    };

    const handleKeyPress = (e, i) => {
        if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
            setAt(i - 1, '');
            focusBox(i - 1);
        }
    };

    return (
        <View style={[styles.otpRow, dimmed && { opacity: 0.5 }]}>
            {digits.map((digit, i) => (
                <TextInput
                    key={i}
                    ref={(r) => (inputRefs.current[i] = r)}
                    value={digit}
                    onChangeText={(t) => handleChange(t, i)}
                    onKeyPress={(e) => handleKeyPress(e, i)}
                    onFocus={() => setFocused(i)}
                    keyboardType="number-pad"
                    maxLength={OTP_LENGTH}
                    autoFocus={i === 0}
                    selectTextOnFocus
                    editable={!dimmed}
                    selectionColor={colors.primary}
                    autoComplete={i === 0 ? 'sms-otp' : 'off'}
                    textContentType={i === 0 ? 'oneTimeCode' : 'none'}
                    importantForAutofill={i === 0 ? 'yes' : 'no'}
                    style={[
                        styles.otpBox,
                        !!digit && { borderColor: colors.ink },
                        focused === i && !hasError && { borderColor: colors.primary, borderWidth: 2 },
                        hasError && { borderColor: colors.error, borderWidth: 2 },
                    ]}
                />
            ))}
        </View>
    );
}

/* ---------------------------------- screen --------------------------------- */

export default function LoginScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const loginStore = useAuthStore(state => state.login);

    // 1. Fetch dynamic theme configuration
    const { theme } = useThemeStore();

    const primaryColor = theme?.colors?.primary || '#E23744';
    const primaryLight = theme?.colors?.primaryLight || '#EE4B58';
    const primaryDark = theme?.colors?.primaryDark || '#D42A38';
    const errorColor = theme?.colors?.error || '#C62828';
    const inkColor = theme?.colors?.text || '#1A1A1A';

    const brandName = theme?.name || 'Delivery';
    const tagline = theme?.tagline || 'Delicious food, delivered to your door';

    const heroImages = theme?.heroImages || [];
    const heroCount = heroImages.length;
    const heroLoop = heroCount > 1;
    const heroData = heroLoop
        ? [heroImages[heroCount - 1], ...heroImages, heroImages[0]]
        : heroImages;
    const heroStart = heroLoop ? 1 : 0;

    const [step, setStep] = useState('phone');
    const [phone, setPhone] = useState('');
    const [digits, setDigits] = useState(EMPTY_DIGITS);
    const otp = digits.join('');
    const [phoneFocused, setPhoneFocused] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [otpMounted, setOtpMounted] = useState(false);

    const phoneRef = useRef(null);
    const otpRefs = useRef([]);
    const verifyingRef = useRef(false);
    const stepChangedAt = useRef(0);
    const listenerSub = useRef(null);
    const caretTimer = useRef(null);
    const [caretHidden, setCaretHidden] = useState(false);

    useEffect(() => () => clearTimeout(caretTimer.current), []);

    /* ------------------------- keyboard-synced animation ------------------------ */
    const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true });
    const bottomInset = insets.bottom;

    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const panelIn = useSharedValue(1);
    const stepProgress = useSharedValue(0);

    const phoneFade = useSharedValue(1);
    const animatePhoneIn = () => {
        phoneFade.value = 0;
        phoneFade.value = withDelay(
            70,
            withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) })
        );
    };

    /* ------------------------------- hero carousel ------------------------------ */
    const [heroHeight, setHeroHeight] = useState(Math.round(windowHeight * 0.6));
    const heroMeasured = useRef(false);
    const heroListRef = useRef(null);
    const heroIndex = useRef(heroStart);
    const autoTimer = useRef(null);
    const settleTimer = useRef(null);
    const scrollX = useSharedValue(windowWidth * heroStart);

    const onHeroScroll = useAnimatedScrollHandler((e) => {
        scrollX.value = e.contentOffset.x;
    });

    const settleHero = useCallback(
        (idx) => {
            let i = idx;
            if (heroLoop) {
                if (i <= 0) i = heroCount;
                else if (i >= heroCount + 1) i = 1;
                if (i !== idx) {
                    heroListRef.current?.scrollToOffset({ offset: i * windowWidth, animated: false });
                }
            }
            heroIndex.current = i;
        },
        [windowWidth, heroLoop, heroCount]
    );

    const stopAuto = useCallback(() => {
        clearInterval(autoTimer.current);
        clearTimeout(settleTimer.current);
    }, []);

    const startAuto = useCallback(() => {
        clearInterval(autoTimer.current);
        autoTimer.current = setInterval(() => {
            const next = heroIndex.current + 1;
            heroIndex.current = next;
            heroListRef.current?.scrollToOffset({ offset: next * windowWidth, animated: true });
            clearTimeout(settleTimer.current);
            settleTimer.current = setTimeout(() => settleHero(next), 650);
        }, HERO_INTERVAL);
    }, [windowWidth, settleHero]);

    useEffect(() => {
        if (heroCount > 0) startAuto();
        return stopAuto;
    }, [startAuto, stopAuto, heroCount]);

    useEffect(() => {
        panelIn.value = withTiming(0, { duration: 550, easing: Easing.out(Easing.cubic) });
    }, []);

    useEffect(() => {
        stepProgress.value = withTiming(step === 'otp' ? 1 : 0, {
            duration: 260,
            easing: Easing.out(Easing.cubic),
        });
        if (step === 'otp') {
            setOtpMounted(true);
            return;
        }
        const t = setTimeout(() => setOtpMounted(false), 300);
        return () => clearTimeout(t);
    }, [step]);

    const shift = useDerivedValue(() => Math.max(0, keyboard.height.value - bottomInset));

    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: panelIn.value * windowHeight * 0.5 - shift.value }],
    }));

    const phoneStepStyle = useAnimatedStyle(() => ({
        opacity: 1 - stepProgress.value,
        transform: [{ translateX: -28 * stepProgress.value }],
    }));

    const otpStepStyle = useAnimatedStyle(() => ({
        opacity: stepProgress.value,
        transform: [{ translateX: 28 * (1 - stepProgress.value) }],
    }));

    const brandStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -shift.value }],
    }));

    const phoneTextStyle = useAnimatedStyle(() => ({ opacity: phoneFade.value }));

    const dimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(keyboard.height.value, [0, 160], [0, 1], Extrapolation.CLAMP),
    }));

    /* ----------------------------- navigation helpers ---------------------------- */
    const goToMain = useCallback(() => {
        let nav = navigation;
        while (nav) {
            if (nav.getState?.()?.routeNames?.includes(MAIN_ROUTE)) {
                nav.reset({ index: 0, routes: [{ name: MAIN_ROUTE }] });
                return;
            }
            nav = nav.getParent?.();
        }
        console.warn(
            `[LoginScreen] No navigator has a "${MAIN_ROUTE}" route. Fix MAIN_ROUTE, or if your ` +
            'navigator switches on auth state, update that state here instead of navigating.'
        );
    }, [navigation]);

    const handleSkip = () => {
        Keyboard.dismiss();
        goToMain();
    };

    /* ----------------- re-open keyboard after Android back button ----------------- */
    useEffect(() => {
        const sub = Keyboard.addListener('keyboardDidHide', () => {
            if (Date.now() - stepChangedAt.current < 600) return;
            phoneRef.current?.blur();
            otpRefs.current.forEach((r) => r?.blur());
        });
        return () => sub.remove();
    }, []);

    /* ------------------------- phone number autofill (Android) ------------------------ */
    const sendOtpRef = useRef(null);

    useEffect(() => {
        if (Platform.OS !== 'android' || !SmsRetriever) return;
        const timer = setTimeout(async () => {
            try {
                if (typeof SmsRetriever?.requestPhoneNumber !== 'function') return;
                const raw = await SmsRetriever.requestPhoneNumber();
                const num = normalizePhone(raw);
                if (num.length === 10) {
                    setPhone(num);
                    animatePhoneIn();
                    // 🔥 Auto-trigger the OTP send instantly!
                    sendOtpRef.current(num);
                }
            } catch (e) {
            }
        }, 700);
        return () => clearTimeout(timer);
    }, []);

    /* ---------------------------------- OTP auto-read --------------------------------- */
    const stopOtpListener = useCallback(() => {
        listenerSub.current?.remove?.();
        listenerSub.current = null;
        try {
            OtpVerify?.removeListener?.();
        } catch (e) { }
    }, []);

    const startOtpListener = useCallback(() => {
        if (Platform.OS !== 'android' || !OtpVerify) return;
        stopOtpListener();
        try {
            Promise.resolve(
                OtpVerify.startOtpListener((message) => {
                    const m = new RegExp(`\\b(\\d{${OTP_LENGTH}})\\b`).exec(message || '');
                    if (m) setDigits(m[1].split('').slice(0, OTP_LENGTH));
                })
            )
                .then((sub) => {
                    listenerSub.current = sub;
                })
                .catch(() => { });
        } catch (e) { }
    }, [stopOtpListener]);

    useEffect(() => stopOtpListener, [stopOtpListener]);

    /* ---------------------------------- resend timer ---------------------------------- */
    useEffect(() => {
        if (secondsLeft <= 0) return;
        const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [secondsLeft]);

    /* ------------------------------------ actions ------------------------------------ */
    const sendOtp = useCallback(async (autoPhone) => {
        // If autoPhone is a string (from auto-complete), use it. Otherwise use state.
        const targetPhone = typeof autoPhone === 'string' ? autoPhone : phone;

        if (targetPhone.length !== 10 || loading) return;
        setError('');
        setLoading(true);
        setDigits(EMPTY_DIGITS);
        startOtpListener();
        try {
            await api.post('/auth/send-otp', { phone: targetPhone }); // Use targetPhone here
            setSecondsLeft(RESEND_SECONDS);
            stepChangedAt.current = Date.now();
            setStep('otp');
        } catch (e) {
            stopOtpListener();
            setError(e.response?.data?.error || 'Could not send OTP. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [phone, loading, startOtpListener, stopOtpListener]);

    useEffect(() => {
        sendOtpRef.current = sendOtp;
    }, [sendOtp]);

    const verifyOtp = useCallback(
        async (code) => {
            if (verifyingRef.current) return;
            verifyingRef.current = true;
            setError('');
            setLoading(true);
            try {
                // REAL API CALL
                const { data } = await api.post('/auth/verify-otp', { phone, otp: code });

                stopOtpListener();
                Keyboard.dismiss();

                // SAVE SECURE TOKENS
                await loginStore(data.user, data.accessToken, data.refreshToken);

                goToMain();
            } catch (e) {
                setError(e.response?.data?.error || 'Incorrect OTP. Please try again.');
                setDigits(EMPTY_DIGITS);
                setTimeout(() => otpRefs.current[0]?.focus(), 80);
            } finally {
                verifyingRef.current = false;
                setLoading(false);
            }
        },
        [phone, goToMain, stopOtpListener, loginStore]
    );

    useEffect(() => {
        if (step === 'otp' && otp.length === OTP_LENGTH) verifyOtp(otp);
    }, [otp, step, verifyOtp]);

    const resendOtp = async () => {
        if (secondsLeft > 0 || loading) return;
        setError('');
        setDigits(EMPTY_DIGITS);
        startOtpListener();
        try {
            // REAL API CALL
            await api.post('/auth/send-otp', { phone });
            setSecondsLeft(RESEND_SECONDS);
            otpRefs.current[0]?.focus();
        } catch (e) {
            setError(e.response?.data?.error || 'Could not resend OTP.');
        }
    };

    const changeNumber = () => {
        stopOtpListener();
        setError('');
        setDigits(EMPTY_DIGITS);
        stepChangedAt.current = Date.now();
        setStep('phone');
        setTimeout(() => phoneRef.current?.focus(), 300);
    };

    /* ------------------------ Android back button on OTP step ------------------------ */
    useEffect(() => {
        if (step !== 'otp') return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (!navigation.isFocused()) return false;
            if (loading) return true;
            changeNumber();
            return true;
        });
        return () => sub.remove();
    }, [step, loading, navigation]);

    /* ------------------------------------- UI ------------------------------------- */
    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

            {/* HERO */}
            <View
                style={styles.hero}
                onLayout={(e) => {
                    if (heroMeasured.current) return;
                    heroMeasured.current = true;
                    setHeroHeight(Math.round(e.nativeEvent.layout.height));
                }}
            >
                {heroData.length > 0 && (
                    <Animated.FlatList
                        ref={heroListRef}
                        data={heroData}
                        initialScrollIndex={heroStart}
                        keyExtractor={(_, i) => String(i)}
                        horizontal
                        pagingEnabled
                        bounces={false}
                        overScrollMode="never"
                        showsHorizontalScrollIndicator={false}
                        scrollEventThrottle={16}
                        onScroll={onHeroScroll}
                        onScrollBeginDrag={stopAuto}
                        onMomentumScrollEnd={(e) => {
                            clearTimeout(settleTimer.current);
                            settleHero(Math.round(e.nativeEvent.contentOffset.x / windowWidth));
                            startAuto();
                        }}
                        getItemLayout={(_, index) => ({
                            length: windowWidth,
                            offset: windowWidth * index,
                            index,
                        })}
                        style={StyleSheet.absoluteFill}
                        renderItem={({ item }) => (
                            <Image
                                source={item}
                                style={{ width: windowWidth, height: heroHeight, backgroundColor: '#1A1A1A' }}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                transition={300}
                            />
                        )}
                    />
                )}

                <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
                    style={styles.topShade}
                />
                <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']}
                    style={styles.bottomShade}
                />
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }, dimStyle]}
                />

                {/* dynamic wordmark */}
                <Animated.View pointerEvents="none" style={[styles.brandWrap, brandStyle]}>
                    <Animated.View entering={FadeInDown.delay(250).duration(600)}>
                        <Text style={styles.brandText}>{brandName}</Text>
                        <Text style={styles.brandTagline}>{tagline}</Text>
                    </Animated.View>

                    <View style={styles.dots}>
                        {heroImages.map((_, i) => (
                            <Dot
                                key={i}
                                index={i}
                                scrollX={scrollX}
                                width={windowWidth}
                                heroCount={heroCount}
                                heroLoop={heroLoop}
                            />
                        ))}
                    </View>
                </Animated.View>
            </View>

            {/* SKIP */}
            <Animated.View
                entering={FadeInDown.delay(500)}
                style={[styles.skipWrap, { top: insets.top + 12 }]}
            >
                <Pressable onPress={handleSkip} style={styles.skipButton} hitSlop={10}>
                    <Text style={styles.skipText}>Skip</Text>
                </Pressable>
            </Animated.View>

            {/* LOGIN PANEL */}
            <View style={styles.panelOuter}>
                <Animated.View style={[styles.panel, { paddingBottom: insets.bottom + 16 }, panelStyle]}>
                    <View style={styles.titleRow}>
                        <View style={styles.titleLine} />
                        <Text style={styles.title}>Log in or sign up</Text>
                        <View style={styles.titleLine} />
                    </View>

                    <View style={{ height: STEP_HEIGHT }}>
                        <Animated.View
                            pointerEvents={step === 'phone' ? 'auto' : 'none'}
                            style={[styles.step, phoneStepStyle]}
                        >
                            <View
                                style={[
                                    styles.inputRow,
                                    { borderColor: phoneFocused || phone ? primaryColor : '#E3E3E3' },
                                ]}
                            >
                                <View style={styles.countryCode}>
                                    <Text style={styles.flag}>🇮🇳</Text>
                                    <Text style={styles.countryCodeText}>+91</Text>
                                    <View style={styles.verticalDivider} />
                                </View>
                                <Animated.View style={[styles.phoneField, phoneTextStyle]}>
                                    <TextInput
                                        ref={phoneRef}
                                        style={styles.phoneInput}
                                        keyboardType="phone-pad"
                                        placeholder="Enter phone number"
                                        placeholderTextColor="#9A9A9A"
                                        value={phone}
                                        onChangeText={(t) => {
                                            setError('');
                                            const next = normalizePhone(t);

                                            // Bulk = more than one new digit arrived at once (autocomplete or paste).
                                            // Typing '#', '*' or '+' adds no digits, so it is never bulk.
                                            const bulk = next.length - phone.length > 1;

                                            // Strip junk characters from the visible field
                                            if (t !== next) {
                                                try {
                                                    phoneRef.current?.setNativeProps({ text: next });
                                                } catch (e) { }
                                            }

                                            if (bulk) {
                                                animatePhoneIn();
                                                setCaretHidden(true);
                                                clearTimeout(caretTimer.current);
                                                caretTimer.current = setTimeout(() => setCaretHidden(false), 280);
                                            }

                                            setPhone(next);

                                            // Auto-send only when a full number was filled in one go
                                            if (bulk && next.length === 10) {
                                                setTimeout(() => {
                                                    sendOtpRef.current?.(next);
                                                }, 150);
                                            }
                                        }}
                                        caretHidden={caretHidden}
                                        onFocus={() => setPhoneFocused(true)}
                                        onBlur={() => setPhoneFocused(false)}
                                        maxLength={16}
                                        autoComplete="tel-national"
                                        textContentType="telephoneNumber"
                                        importantForAutofill="yes"
                                        selectionColor={primaryColor}
                                        cursorColor={primaryColor}
                                        selectionHandleColor={primaryColor}
                                        returnKeyType="done"
                                        onSubmitEditing={sendOtp}
                                    />
                                </Animated.View>
                                {phone.length > 0 && (
                                    <Pressable
                                        onPress={() => {
                                            setPhone('');
                                            setError('');
                                            phoneRef.current?.focus();
                                        }}
                                        hitSlop={12}
                                        style={styles.clearButton}
                                    >
                                        <Text style={styles.clearIcon}>✕</Text>
                                    </Pressable>
                                )}
                            </View>

                            <PrimaryButton
                                title="Continue"
                                onPress={sendOtp}
                                disabled={phone.length !== 10}
                                loading={loading}
                                colors={[primaryLight, primaryDark]}
                            />

                            {!!error && <Text style={[styles.errorText, { color: errorColor }]}>{error}</Text>}
                        </Animated.View>

                        {otpMounted && (
                            <Animated.View
                                pointerEvents={step === 'otp' ? 'auto' : 'none'}
                                style={[styles.step, otpStepStyle]}
                            >
                                <Text style={styles.otpSubtitle}>
                                    Enter the {OTP_LENGTH}-digit code sent to{' '}
                                    <Text style={styles.otpPhone}>
                                        +91 {phone.slice(0, 5)} {phone.slice(5)}
                                    </Text>
                                </Text>

                                <OtpBoxes
                                    digits={digits}
                                    setDigits={setDigits}
                                    inputRefs={otpRefs}
                                    hasError={!!error}
                                    dimmed={loading}
                                    onEdit={() => setError('')}
                                    colors={{ primary: primaryColor, error: errorColor, ink: inkColor }}
                                />

                                {!!error ? (
                                    <Text style={[styles.errorText, { color: errorColor }]}>{error}</Text>
                                ) : loading ? (
                                    <View style={styles.verifyingRow}>
                                        <ActivityIndicator size="small" color={primaryColor} />
                                        <Text style={styles.verifyingText}>Verifying...</Text>
                                    </View>
                                ) : (
                                    <View style={styles.otpFooter}>
                                        <Pressable onPress={changeNumber} hitSlop={10}>
                                            <Text style={[styles.linkText, { color: primaryColor }]}>Change number</Text>
                                        </Pressable>
                                        <Pressable onPress={resendOtp} disabled={secondsLeft > 0} hitSlop={10}>
                                            <Text
                                                style={[
                                                    styles.linkText,
                                                    { color: secondsLeft > 0 ? '#9A9A9A' : primaryColor },
                                                ]}
                                            >
                                                {secondsLeft > 0
                                                    ? `Resend in 0:${String(secondsLeft).padStart(2, '0')}`
                                                    : 'Resend OTP'}
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}
                            </Animated.View>
                        )}
                    </View>

                    <Text style={styles.terms}>
                        By continuing, you agree to our{'\n'}
                        <Text style={styles.termsLink}>Terms of Service</Text>
                        {'   '}
                        <Text style={styles.termsLink}>Privacy Policy</Text>
                    </Text>
                </Animated.View>
            </View>
        </View>
    );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#111111',
    },
    hero: {
        flex: 1,
        backgroundColor: '#111111',
    },
    topShade: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 120,
    },
    bottomShade: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '55%',
    },
    brandWrap: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 28 + 20,
    },
    brandText: {
        fontSize: 52,
        fontWeight: '900',
        letterSpacing: -1.5,
        color: '#FFFFFF',
        textShadowColor: 'rgba(0,0,0,0.35)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 8,
    },
    brandTagline: {
        marginTop: 2,
        fontSize: 15,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.9)',
        textShadowColor: 'rgba(0,0,0,0.35)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
    },
    dots: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
    },
    dot: {
        height: 8,
        borderRadius: 4,
        marginRight: 6,
        backgroundColor: '#FFFFFF',
    },
    skipWrap: {
        position: 'absolute',
        right: 16,
        zIndex: 10,
    },
    skipButton: {
        backgroundColor: 'rgba(0,0,0,0.35)',
        borderColor: 'rgba(255,255,255,0.35)',
        borderWidth: 1,
        paddingVertical: 7,
        paddingHorizontal: 18,
        borderRadius: 20,
    },
    skipText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    panelOuter: {
        marginTop: -28,
    },
    panel: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 24,
        paddingTop: 26,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 22,
    },
    titleLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#ECECEC',
    },
    title: {
        marginHorizontal: 14,
        fontSize: 15,
        fontWeight: '600',
        color: '#555555',
    },
    step: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderWidth: 1.5,
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        marginBottom: 16,
    },
    countryCode: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        height: '100%',
    },
    flag: { fontSize: 20, marginRight: 6 },
    countryCodeText: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
    verticalDivider: {
        width: 1,
        height: 24,
        backgroundColor: '#E3E3E3',
        marginLeft: 12,
    },
    phoneField: {
        flex: 1,
        height: '100%',
    },
    phoneInput: {
        flex: 1,
        height: '100%',
        paddingHorizontal: 14,
        paddingVertical: 0,
        fontSize: 16,
        fontWeight: '500',
        color: '#1A1A1A',
    },
    clearButton: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#E8E8E8',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    clearIcon: {
        fontSize: 11,
        fontWeight: '700',
        color: '#555555',
    },
    buttonWrap: {
        borderRadius: 14,
        overflow: 'hidden',
    },
    button: {
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    otpSubtitle: {
        fontSize: 14,
        color: '#666666',
        marginBottom: 16,
        textAlign: 'center',
    },
    otpPhone: { color: '#1A1A1A', fontWeight: '700' },
    otpRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 18,
    },
    otpBox: {
        width: 46,
        height: 56,
        marginHorizontal: 4,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#E3E3E3',
        backgroundColor: '#FAFAFA',
        textAlign: 'center',
        fontSize: 24,
        fontWeight: '700',
        color: '#1A1A1A',
        padding: 0,
    },
    otpFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
    },
    linkText: {
        fontSize: 14,
        fontWeight: '600',
    },
    verifyingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    verifyingText: {
        marginLeft: 8,
        fontSize: 14,
        fontWeight: '600',
        color: '#666666',
    },
    errorText: {
        marginTop: 10,
        textAlign: 'center',
        fontSize: 13,
        fontWeight: '500',
    },
    terms: {
        marginTop: 4,
        textAlign: 'center',
        fontSize: 12,
        lineHeight: 18,
        color: '#8A8A8A',
    },
    termsLink: {
        color: '#1A1A1A',
        fontWeight: '600',
    },
});