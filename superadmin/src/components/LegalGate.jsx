// The agree screen for administrators (every superadmin except the supreme one). It cannot be closed: "Agree and continue" or "Log out".
// The server decides when it shows: on the person's SECOND visit after a new version was sent.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, AppState, BackHandler } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, font } from '../theme';
import Icon from './Icon';
import LegalText from './LegalText';
import { useAuthStore } from '../store/useAuthStore';
import { fetchLegalStatus, acceptLegal } from '../api/legalApi';
import { errMsg } from '../api/adminClient';

export default function LegalGate() {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const token = useAuthStore((s) => s.token);
    const [doc, setDoc] = useState(null);
    const [ticked, setTicked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const last = useRef(0);

    const check = useCallback(async () => {
        if (!token) return;
        last.current = Date.now();
        try {
            const r = await fetchLegalStatus();
            if (r.required) { setDoc(r); setTicked(false); setErr(''); } else setDoc(null);
        } catch (e) { /* best effort: a network problem must never lock the app */ }
    }, [token]);

    useEffect(() => {
        if (!token) { setDoc(null); return undefined; }
        check();
        const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && Date.now() - last.current > 5 * 60000) check(); });
        return () => sub.remove();
    }, [token, check]);

    useEffect(() => {
        if (!doc) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => sub.remove();
    }, [doc]);

    if (!token || !doc) return null;
    const agree = async () => {
        setBusy(true); setErr('');
        try { await acceptLegal(doc.key, doc.version); setDoc(null); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
    };

    return (
        <Modal visible animationType="slide" onRequestClose={() => { }} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 8 }}>
                <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                    <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '900' }}>{doc.title}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm }}>Please read this and agree to continue</Text>
                </View>
                {doc.summary ? <Text style={{ color: t.text, marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: 10, backgroundColor: t.surface, fontWeight: '700' }}>What is new: {doc.summary}</Text> : null}
                <ScrollView style={{ flex: 1, marginTop: spacing.md }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}>
                    <LegalText text={doc.body} title={doc.title} />
                </ScrollView>
                <View style={{ borderTopWidth: 1, borderTopColor: t.border, padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.md) + 4 }}>
                    <Pressable onPress={() => setTicked((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
                        <Icon name={ticked ? 'ok' : 'check'} size={26} color={ticked ? t.primary : t.muted} filled={ticked} />
                        <Text style={{ color: t.text, flex: 1, marginLeft: 10, fontWeight: '700' }}>I have read this and I agree</Text>
                    </Pressable>
                    {err ? <Text style={{ color: t.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
                    <Pressable onPress={agree} disabled={!ticked || busy} style={{ minHeight: 50, borderRadius: 14, backgroundColor: t.primary, opacity: !ticked || busy ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}>
                        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: font.md }}>Agree and continue</Text>}
                    </Pressable>
                    <Pressable onPress={() => { useAuthStore.getState().logout(); setDoc(null); }} hitSlop={10} style={{ alignItems: 'center', paddingVertical: spacing.md }}>
                        <Text style={{ color: t.muted, fontWeight: '800' }}>Log out</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
