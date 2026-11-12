// The public demo website's front door. Shown ONLY on the demo shop (the server marks it in the theme) and only to a person who is not
// signed in yet: first a short welcome animation (company logo and name, "Welcome" in five languages, a Skip button, once per visit),
// then one big button that opens the demo with a single tap: no OTP, no login. Every other shop and the phone apps never see this.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Image, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useBrand } from './kit';
import api from '../../api/common/client';
import { reloadApp } from '../../utils/common/switchBranch';

const WELCOME = ['Welcome', 'स्वागत है', 'स्वागत आहे', 'સ્વાગત છે', 'স্বাগতম'];   // English, Hindi, Marathi, Gujarati, Bengali
const SEEN_KEY = 'demoWelcomeSeen';
const STEP_MS = 1100;
const DEFAULT_COMPANY = 'Vivyaan Business Systems Pvt. Ltd.';

// "once per visit": remembered for this browser tab (the phone app: for this run)
let seenThisRun = false;
const wasSeen = () => {
    if (seenThisRun) return true;
    try { if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage.getItem(SEEN_KEY)) return true; } catch (e) { /* storage blocked */ }
    return false;
};
const markSeen = () => {
    seenThisRun = true;
    try { if (Platform.OS === 'web' && typeof window !== 'undefined') window.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* storage blocked */ }
};

export default function DemoGate() {
    const demo = useThemeStore((s) => !!s.theme.demo);
    const company = useThemeStore((s) => s.theme.demoCompany) || {};
    const shop = useThemeStore((s) => s.theme.name);
    const user = useAuthStore((s) => s.user);
    const hydrated = useAuthStore((s) => s.isHydrated);
    const login = useAuthStore((s) => s.login);
    const insets = useSafeAreaInsets();
    const { background, text, muted, primary, onPrimary, surface, border } = useBrand();
    const [phase, setPhase] = useState(() => (wasSeen() ? 'enter' : 'welcome'));   // welcome | enter
    const [i, setI] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const fade = useRef(new Animated.Value(0)).current;
    const pop = useRef(new Animated.Value(0)).current;

    // the logo and name come in, then the greeting changes language every moment
    useEffect(() => {
        if (!demo || phase !== 'welcome') return undefined;
        Animated.timing(pop, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        const id = setInterval(() => setI((n) => n + 1), STEP_MS);
        return () => clearInterval(id);
    }, [demo, phase, pop]);
    useEffect(() => {
        if (phase !== 'welcome') return;
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
        if (i >= WELCOME.length) { markSeen(); setPhase('enter'); }   // every language shown once: on to the entry
    }, [i, phase, fade]);

    if (!demo || !hydrated || user) return null;

    const skip = () => { markSeen(); setPhase('enter'); };
    const enter = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const { data } = await api.post('/demo/enter');
            await login(data.user, data.accessToken, data.refreshToken);
        } catch (e) {
            setError(e.response?.data?.error || 'Could not open the demo. Please try again.');
            setBusy(false);
        }
    };

    const name = company.name || DEFAULT_COMPANY;
    const logo = company.logoUrl;
    return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: background, zIndex: 100, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 }]}>
            {phase === 'welcome' ? (
                <>
                    <Pressable onPress={skip} accessibilityLabel="Skip" style={{ position: 'absolute', top: insets.top + 16, right: 20, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: border }}>
                        <Text style={{ color: muted, fontWeight: '700' }}>Skip</Text>
                    </Pressable>
                    <Animated.View style={{ alignItems: 'center', opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
                        {logo ? <Image source={{ uri: logo }} style={{ width: 96, height: 96, borderRadius: 24, marginBottom: 20 }} resizeMode="contain" /> : (
                            <View style={{ width: 96, height: 96, borderRadius: 28, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                                <Text style={{ color: onPrimary, fontSize: 44, fontWeight: '900' }}>{name.trim().charAt(0).toUpperCase()}</Text>
                            </View>
                        )}
                        <Text style={{ color: text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{name}</Text>
                    </Animated.View>
                    <Animated.Text style={{ color: primary, fontSize: 40, fontWeight: '900', marginTop: 36, opacity: fade, textAlign: 'center', transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                        {WELCOME[Math.min(i, WELCOME.length - 1)]}
                    </Animated.Text>
                </>
            ) : (
                <View style={{ alignItems: 'center', width: '100%', maxWidth: 420 }}>
                    {logo ? <Image source={{ uri: logo }} style={{ width: 72, height: 72, borderRadius: 20, marginBottom: 14 }} resizeMode="contain" /> : null}
                    <Text style={{ color: muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 }}>{name}</Text>
                    <Text style={{ color: text, fontSize: 28, fontWeight: '900', textAlign: 'center' }}>Try the {shop || 'Demo Shop'} app</Text>
                    <Text style={{ color: muted, fontSize: 15, textAlign: 'center', marginTop: 10, marginBottom: 28, lineHeight: 22 }}>
                        See what your customers, your cooks and your riders see. Nothing here is real: no real orders, money or messages.
                    </Text>
                    <Pressable onPress={enter} disabled={busy} style={({ pressed }) => [{ width: '100%', paddingVertical: 16, borderRadius: 18, backgroundColor: primary, alignItems: 'center', opacity: pressed || busy ? 0.8 : 1 }]}>
                        {busy ? <ActivityIndicator color={onPrimary} /> : <Text style={{ color: onPrimary, fontSize: 17, fontWeight: '800' }}>Start the demo</Text>}
                    </Pressable>
                    {error ? <Text style={{ color: '#C62828', marginTop: 14, textAlign: 'center' }}>{error}</Text> : null}
                    <View style={{ marginTop: 22, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
                        <Text style={{ color: muted, fontSize: 12, textAlign: 'center' }}>After you start, tap the Demo button at the top to become the Owner, Cook, Waiter or Rider.</Text>
                    </View>
                </View>
            )}
        </View>
    );
}
