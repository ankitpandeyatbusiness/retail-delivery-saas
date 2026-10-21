// The app lock screens: the lock itself, the 4-digit PIN pad, the setup (choose how to unlock) and the settings page.
// Easy on purpose: one tap to unlock with the phone's own lock, or four digits; a forgotten PIN has a clear way out (sign in again, set a new one).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, Switch, Alert, ScrollView, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
const tr = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? '')) : s);
// the colours this screen needs, from the panel's theme (light or dark)
const useColors = () => { const t = useTheme(); return { bg: t.bg, surface: t.surface, text: t.text, muted: t.muted, border: t.border, primary: t.primary, onPrimary: '#FFFFFF', danger: t.danger, ok: t.success }; };
import { useLockStore } from './useLockStore';
import { AUTO_CHOICES, support } from './appLockCore';

const alpha = (hex, a) => { const h = String(hex).replace('#', ''); if (h.length !== 6) return hex; return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };

function Btn({ label, icon, onPress, kind = 'primary', busy, disabled, style }) {
    const c = useColors();
    const fill = kind === 'primary' ? c.primary : 'transparent';
    const ink = kind === 'primary' ? c.onPrimary : c.text;
    return (
        <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button" style={({ pressed }) => [{ minHeight: 50, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: fill, borderWidth: kind === 'primary' ? 0 : 1, borderColor: c.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }, style]}>
            {icon ? <Ionicons name={icon} size={19} color={ink} style={{ marginRight: 8 }} /> : null}
            <Text style={{ color: ink, fontWeight: '800', fontSize: 15 }}>{label}</Text>
        </Pressable>
    );
}

// four dots and a keypad. onDone(pin) when four digits are in.
export function PinPad({ onDone, error, note, disabled, extraLeft }) {
    const c = useColors();
    const [pin, setPin] = useState('');
    const press = (d) => {
        if (disabled) return;
        const next = (pin + d).slice(0, 4);
        setPin(next);
        if (next.length === 4) setTimeout(() => { onDone(next); setPin(''); }, 120);
    };
    const key = (label, onPress, icon) => (
        <Pressable key={label} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={icon ? label : undefined} style={({ pressed }) => ({ width: 76, height: 62, borderRadius: 31, margin: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? alpha(c.primary, 0.18) : c.surface, borderWidth: 1, borderColor: c.border, opacity: disabled ? 0.5 : 1 })}>
            {icon ? <Ionicons name={icon} size={24} color={c.text} /> : <Text style={{ color: c.text, fontSize: 26, fontWeight: '700' }}>{label}</Text>}
        </Pressable>
    );
    const blank = <View key="blank" style={{ width: 76, height: 62, margin: 7 }} />;
    return (
        <View style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', marginVertical: 18 }}>
                {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 16, height: 16, borderRadius: 8, marginHorizontal: 9, backgroundColor: i < pin.length ? c.primary : 'transparent', borderWidth: 2, borderColor: error ? c.danger : c.primary }} />)}
            </View>
            <Text style={{ minHeight: 20, color: error ? c.danger : c.muted, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>{error || note || ''}</Text>
            {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => <View key={row[0]} style={{ flexDirection: 'row' }}>{row.map((d) => key(d, () => press(d)))}</View>)}
            <View style={{ flexDirection: 'row' }}>
                {extraLeft || blank}
                {key('0', () => press('0'))}
                {key(tr('Delete'), () => setPin((p) => p.slice(0, -1)), 'backspace-outline')}
            </View>
        </View>
    );
}

// covers the app for the split second while the saved lock settings are read at start, so nothing shows before the lock does
function Cover() {
    const c = useColors();
    const ready = useLockStore((s) => s.ready);
    return <Modal visible={!ready} animationType="none" statusBarTranslucent onRequestClose={() => { }}><View style={{ flex: 1, backgroundColor: c.bg }} /></Modal>;
}

// the screen that covers the app while it is locked
function LockModal({ onSignOut }) {
    const c = useColors();
    const { locked, ready, method, biometric } = useLockStore();
    const [error, setError] = useState('');
    const [wait, setWait] = useState(0);
    const [sup, setSup] = useState({ biometric: false });
    const tried = useRef(false);

    useEffect(() => { support().then(setSup); }, []);
    useEffect(() => { if (!locked) { tried.current = false; setError(''); } }, [locked]);
    // the phone's prompt comes up by itself the moment the lock appears (and again on "Unlock")
    const unlockWithPhone = useCallback(async (biometricOnly) => {
        const ok = await useLockStore.getState().tryPhone({ biometricOnly });
        if (!ok && !biometricOnly) setError(tr('Not unlocked. Try again.'));
    }, []);
    useEffect(() => {
        if (!locked || !ready || tried.current) return undefined;
        tried.current = true;
        if (method === 'device') { const t = setTimeout(() => unlockWithPhone(false), 350); return () => clearTimeout(t); }
        if (method === 'pin' && biometric && sup.biometric) { const t = setTimeout(() => unlockWithPhone(true), 350); return () => clearTimeout(t); }
        return undefined;
    }, [locked, ready, method, biometric, sup.biometric, unlockWithPhone]);
    // the 30 second wait counts down
    useEffect(() => {
        if (wait <= 0) return undefined;
        const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
        return () => clearInterval(t);
    }, [wait > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

    const signAgain = async () => { await useLockStore.getState().forgot(); await onSignOut?.(); };
    const forgot = () => Alert.alert(
        method === 'pin' ? tr('Forgot your PIN?') : tr("Can't unlock?"),
        tr('Sign in again with your usual OTP or password, then set a new lock. Your shop data is safe: nothing is deleted.'),
        [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Sign in again'), onPress: signAgain }],
    );
    const onPin = async (pin) => {
        const r = await useLockStore.getState().tryPin(pin);
        if (r.ok) return;
        if (r.out) { Alert.alert(tr('Too many wrong PINs'), tr('For safety, please sign in again.'), [{ text: tr('OK'), onPress: signAgain }]); return; }
        if (r.wait) { setWait(r.wait); setError(tr('Wrong PIN. Wait {n} seconds.', { n: r.wait })); return; }
        setError(r.left === 1 ? tr('Wrong PIN. 1 try left.') : tr('Wrong PIN. {n} tries left.', { n: r.left }));
    };
    return (
        <Modal visible={locked && ready} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={() => { }}>
            <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: alpha(c.primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="lock-closed" size={36} color={c.primary} />
                </View>
                <Text style={{ color: c.text, fontSize: 22, fontWeight: '900', marginTop: 16 }}>{tr('App locked')}</Text>
                {method === 'pin' ? (
                    <PinPad onDone={onPin} error={error} note={wait > 0 ? tr('Wait {n} seconds', { n: wait }) : tr('Enter your PIN')} disabled={wait > 0}
                        extraLeft={biometric && sup.biometric ? <Pressable key="bio" onPress={() => unlockWithPhone(true)} accessibilityRole="button" accessibilityLabel={tr('Use fingerprint or face')} style={{ width: 76, height: 62, margin: 7, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="finger-print" size={32} color={c.primary} /></Pressable> : null} />
                ) : (
                    <View style={{ alignSelf: 'stretch', marginTop: 24 }}>
                        <Text style={{ color: error ? c.danger : c.muted, textAlign: 'center', fontWeight: '700', marginBottom: 14 }}>{error || tr('Use your fingerprint, face or phone lock')}</Text>
                        <Btn label={tr('Unlock')} icon="finger-print" onPress={() => unlockWithPhone(false)} />
                    </View>
                )}
                <Pressable onPress={forgot} hitSlop={10} style={{ marginTop: 22, padding: 8 }}><Text style={{ color: c.primary, fontWeight: '800' }}>{method === 'pin' ? tr('Forgot PIN?') : tr("Can't unlock?")}</Text></Pressable>
            </View>
        </Modal>
    );
}

// choose how to unlock, then set it up. Used by the settings page and, for a required person, by the first-time screen.
export function LockSetup({ onDone, onCancel }) {
    const c = useColors();
    const [sup, setSup] = useState(null);
    const [step, setStep] = useState('choose');   // choose | pin1 | pin2 | bio
    const [first, setFirst] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { support().then(setSup); }, []);
    if (!sup) return <View style={{ padding: 30 }} />;

    const phone = async () => {
        setBusy(true);
        const ok = await useLockStore.getState().enableDevice();
        setBusy(false);
        if (ok) onDone?.(); else setError(tr('Not confirmed. Try again.'));
    };
    const finish = async (bio) => { setBusy(true); await useLockStore.getState().enablePin(pin, bio); setBusy(false); onDone?.(); };
    const card = (icon, title, sub, onPress, off) => (
        <Pressable onPress={onPress} disabled={off || busy} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, marginBottom: 12, opacity: off ? 0.5 : pressed ? 0.75 : 1 })}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: alpha(c.primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}><Ionicons name={icon} size={24} color={c.primary} /></View>
            <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 16 }}>{title}</Text>
                <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.muted} />
        </Pressable>
    );

    if (step === 'pin1' || step === 'pin2') {
        return (
            <View style={{ alignItems: 'center' }}>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 18 }}>{step === 'pin1' ? tr('Choose a 4-digit PIN') : tr('Enter it again')}</Text>
                <PinPad error={error} note={step === 'pin1' ? tr('Not your birthday or 1234') : ''} onDone={(p) => {
                    if (step === 'pin1') { setFirst(p); setError(''); setStep('pin2'); return; }
                    if (p !== first) { setError(tr('The two PINs are different. Start again.')); setStep('pin1'); return; }
                    setPin(p); setError('');
                    if (sup.biometric) setStep('bio'); else { setPin(p); (async () => { setBusy(true); await useLockStore.getState().enablePin(p, false); setBusy(false); onDone?.(); })(); }
                }} />
                <Pressable onPress={() => { setStep('choose'); setError(''); }} hitSlop={10} style={{ padding: 10 }}><Text style={{ color: c.muted, fontWeight: '700' }}>{tr('Back')}</Text></Pressable>
            </View>
        );
    }
    if (step === 'bio') {
        return (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Ionicons name="finger-print" size={54} color={c.primary} />
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 18, marginTop: 10 }}>{tr('Unlock faster?')}</Text>
                <Text style={{ color: c.muted, textAlign: 'center', marginVertical: 10 }}>{tr('Use your fingerprint or face instead of typing the PIN. The PIN always works too.')}</Text>
                <Btn label={tr('Yes, use fingerprint or face')} icon="finger-print" busy={busy} onPress={() => finish(true)} style={{ alignSelf: 'stretch' }} />
                <Btn label={tr('No, only the PIN')} kind="ghost" busy={busy} onPress={() => finish(false)} style={{ alignSelf: 'stretch', marginTop: 8 }} />
            </View>
        );
    }
    return (
        <View>
            <Text style={{ color: c.muted, marginBottom: 14 }}>{tr('Choose how you want to unlock the app.')}</Text>
            {card('phone-portrait-outline', tr('Phone lock or fingerprint / face'), sup.device || sup.biometric ? tr('Uses the lock you already have on this phone: its PIN, pattern, password, fingerprint or face.') : tr('This phone has no screen lock yet. Set one in the phone settings, or use an app PIN.'), phone, !(sup.device || sup.biometric))}
            {card('keypad-outline', tr('App PIN (4 digits)'), tr('A PIN just for this app. Fingerprint or face can be added to it.'), () => { setError(''); setStep('pin1'); })}
            {error ? <Text style={{ color: c.danger, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>{error}</Text> : null}
            {onCancel ? <Btn label={tr('Not now')} kind="ghost" onPress={onCancel} /> : null}
        </View>
    );
}

// a person who must have a lock (the supreme admin) and has not set one yet: this cannot be closed
function SetupModal() {
    const c = useColors();
    const { needSetup, locked, ready } = useLockStore();
    return (
        <Modal visible={needSetup && !locked && ready} animationType="slide" statusBarTranslucent onRequestClose={() => { }}>
            <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center' }}>
                <View style={{ alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: alpha(c.primary, 0.14), alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Ionicons name="shield-checkmark" size={38} color={c.primary} /></View>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 22, textAlign: 'center' }}>{tr('Lock this app')}</Text>
                <Text style={{ color: c.muted, textAlign: 'center', marginTop: 6, marginBottom: 20 }}>{tr('This app controls money, so a lock is required. It takes a few seconds.')}</Text>
                <LockSetup />
            </View>
        </Modal>
    );
}

// the settings page content
export function AppLockSettings() {
    const c = useColors();
    const st = useLockStore();
    const [sup, setSup] = useState({ biometric: false });
    const [setup, setSetup] = useState(false);
    useEffect(() => { support().then(setSup); }, []);
    const row = (title, sub, right, last) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: alpha(c.border, 0.8) }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
                {sub ? <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>{sub}</Text> : null}
            </View>
            {right}
        </View>
    );
    const sw = (value, onValueChange, disabled) => <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: alpha(c.primary, 0.5), false: c.border }} thumbColor={value ? c.primary : c.muted} />;
    const turnOff = () => Alert.alert(tr('Switch the lock off?'), tr('Anyone who opens your phone could open this app.'), [{ text: tr('Keep it on'), style: 'cancel' }, { text: tr('Switch off'), style: 'destructive', onPress: () => st.disable() }]);
    const changePin = () => setSetup('pin');
    return (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 14 }}>
                {row(tr('Lock the app'), st.required ? tr('Required for your account. It cannot be switched off.') : st.enabled ? tr('Asked when you open the app again.') : tr('Ask for your PIN, fingerprint or face when the app opens.'), sw(!!st.enabled, (on) => (on ? setSetup(true) : turnOff()), st.required && st.enabled), !st.enabled)}
                {st.enabled ? row(tr('Unlock with'), st.method === 'pin' ? tr('App PIN (4 digits)') : tr('Phone lock or fingerprint / face'), <Pressable onPress={() => setSetup(true)} hitSlop={8}><Text style={{ color: c.primary, fontWeight: '900' }}>{tr('Change')}</Text></Pressable>) : null}
                {st.enabled && st.method === 'pin' ? row(tr('PIN'), tr('Change your 4-digit PIN'), <Pressable onPress={changePin} hitSlop={8}><Text style={{ color: c.primary, fontWeight: '900' }}>{tr('Change PIN')}</Text></Pressable>) : null}
                {st.enabled && st.method === 'pin' && sup.biometric ? row(tr('Fingerprint or face'), tr('Unlock faster. The PIN always works too.'), sw(!!st.biometric, (v) => st.save({ biometric: v }))) : null}
                {st.enabled ? row(tr('Hide in recent apps'), tr('The app is hidden in the recent-apps list, and screenshots are blocked.'), sw(!!st.hidePreview, (v) => st.save({ hidePreview: v })), true) : null}
            </View>
            {st.enabled ? (
                <View style={{ marginTop: 16, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: 14 }}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{tr('Lock after')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginRight: -8 }}>
                        {AUTO_CHOICES.map(([min, label]) => {
                            const on = st.autoLockMin === min;
                            return (
                                <Pressable key={min} onPress={() => st.save({ autoLockMin: min })} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 20, marginRight: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.primary : 'transparent', borderWidth: 1, borderColor: on ? c.primary : c.border }}>
                                    <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: '800', fontSize: 13.5 }}>{tr(label)}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>{tr('How long the app can stay in the background before it asks again.')}</Text>
                </View>
            ) : null}
            {st.enabled ? <Btn label={tr('Lock now')} icon="lock-closed" kind="ghost" onPress={() => st.lockNow()} style={{ marginTop: 16 }} /> : null}
            <View style={{ marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: alpha(c.primary, 0.08) }}>
                <Text style={{ color: c.text, fontWeight: '800' }}>{tr('Forgot your PIN?')}</Text>
                <Text style={{ color: c.muted, marginTop: 4, lineHeight: 19 }}>{tr('Tap "Forgot PIN?" on the lock screen, sign in again with your usual OTP or password, and set a new lock. Nothing is deleted from your shop.')}</Text>
            </View>

            <Modal visible={!!setup} transparent animationType="slide" onRequestClose={() => setSetup(false)} statusBarTranslucent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 }}>
                        <Text style={{ color: c.text, fontWeight: '900', fontSize: 19, marginBottom: 12 }}>{tr('App lock')}</Text>
                        <LockSetup onDone={() => setSetup(false)} onCancel={() => setSetup(false)} />
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

// Put once, near the root. uid = the signed-in person this lock belongs to (null when nobody is signed in or he needs no lock).
// required = the lock cannot be switched off for him. onSignOut = how to sign out (the "Forgot PIN" way out).
export default function LockGate({ uid, required, onSignOut }) {
    useEffect(() => {
        if (uid) useLockStore.getState().init({ uid: String(uid), required: !!required }); else useLockStore.getState().reset();
    }, [uid, required]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (s) => { if (s === 'background') useLockStore.getState().background(); else if (s === 'active') useLockStore.getState().foreground(); });
        return () => sub.remove();
    }, []);
    if (!uid) return null;
    return (
        <>
            <Cover />
            <LockModal onSignOut={onSignOut} />
            <SetupModal />
        </>
    );
}
