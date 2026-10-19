// The agree screen for shop owners and riders. It cannot be closed: the only ways out are "Agree and continue" and "Log out".
// When it shows is decided by the server (backend/src/services/legal.js): on the person's SECOND visit after the admin sent a
// new version, and only after the shop was handed over. Opening the app counts as a visit when it was closed for 30+ minutes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, AppState, BackHandler, StyleSheet } from 'react-native';
import { ActivityIndicator } from './Loading';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from './kit';
import LegalText from './LegalText';
import { useAuthStore } from '../../store/common/useAuthStore';
import { fetchLegalStatus, acceptLegal } from '../../api/common/legalApi';
import { tr } from '../../i18n';

export default function LegalGate() {
    const { surface, text, muted, border, primary, onPrimary, error } = useBrand();
    const insets = useSafeAreaInsets();
    const role = useAuthStore((s) => s.user?.role);
    const userId = useAuthStore((s) => s.user?.id || s.user?._id);
    const [doc, setDoc] = useState(null);
    const [ticked, setTicked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const last = useRef(0);
    const on = role === 'admin' || role === 'rider';

    const check = useCallback(async () => {
        if (!on) return;
        last.current = Date.now();
        try {
            const r = await fetchLegalStatus();
            if (r.required) { setDoc(r); setTicked(false); setErr(''); } else setDoc(null);
        } catch (e) { /* the agree screen is best effort: a network problem must never lock the panel */ }
    }, [on]);

    // when the app opens, and when it comes back to the front (the server counts a visit only after 30 minutes away)
    useEffect(() => {
        if (!on) { setDoc(null); return undefined; }
        check();
        const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && Date.now() - last.current > 5 * 60000) check(); });
        return () => sub.remove();
    }, [on, userId, check]);

    // the back button does nothing while the screen is up
    useEffect(() => {
        if (!doc) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => sub.remove();
    }, [doc]);

    if (!on || !doc) return null;

    const agree = async () => {
        setBusy(true); setErr('');
        try { await acceptLegal(doc.key, doc.version); setDoc(null); }
        catch (e) { setErr(e?.response?.data?.error || tr('Could not save. Please try again.')); } finally { setBusy(false); }
    };
    const logout = () => { useAuthStore.getState().logout?.().catch?.(() => { }); setDoc(null); };

    return (
        <Modal visible animationType="slide" onRequestClose={() => { }} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: surface, paddingTop: insets.top + 8 }}>
                <View style={{ paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="document-text" size={22} color={primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 17, fontWeight: '900' }}>{doc.title}</Text>
                        <Text style={{ color: muted, fontSize: 12 }}>{tr('Please read this and agree to continue')}</Text>
                    </View>
                </View>
                {doc.summary ? <Text style={{ color: text, backgroundColor: alpha(primary, 0.1), marginHorizontal: 18, padding: 10, borderRadius: 10, fontSize: 13, fontWeight: '700' }}>{tr('What is new: {summary}', { summary: doc.summary })}</Text> : null}
                <ScrollView style={{ flex: 1, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 20 }}>
                    <LegalText text={doc.body} title={doc.title} />
                </ScrollView>
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border, padding: 16, paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
                    <Pressable onPress={() => setTicked((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                        <Ionicons name={ticked ? 'checkbox' : 'square-outline'} size={26} color={ticked ? primary : muted} />
                        <Text style={{ color: text, flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '700' }}>{tr('I have read this and I agree')}</Text>
                    </Pressable>
                    {err ? <Text style={{ color: error, marginBottom: 8 }}>{err}</Text> : null}
                    <Pressable
                        onPress={agree}
                        disabled={!ticked || busy}
                        style={{ minHeight: 50, borderRadius: 14, backgroundColor: primary, opacity: !ticked || busy ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}
                    >
                        {busy ? <ActivityIndicator color={onPrimary} /> : <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 16 }}>{tr('Agree and continue')}</Text>}
                    </Pressable>
                    <Pressable onPress={logout} hitSlop={10} style={{ alignItems: 'center', paddingVertical: 12 }}>
                        <Text style={{ color: muted, fontWeight: '800' }}>{tr('Log out')}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
