// "Did you like the demo?": a short form on the PUBLIC demo (name, shop name, mobile). The team calls them. It opens by itself when
// the Full tour ends, and from the "I liked it" row in the Demo list. Shown only on the demo shop's website; the phone apps never see it.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useBrand } from '../components/common/kit';
import { Sheet } from '../components/owners/ui';
import api from '../api/common/client';
import { useThemeStore } from '../store/common/useThemeStore';
import { useLang, tr } from '../i18n';
import { useTutorialStore } from './store';

export default function DemoLeadForm() {
    const demoShop = useThemeStore((s) => !!s.theme.demo);
    const open = useTutorialStore((s) => s.leadOpen);
    const close = useTutorialStore((s) => s.closeLead);
    const lang = useLang((s) => s.lang);
    const { text, muted, border, primary, onPrimary, surface, background } = useBrand();
    const [name, setName] = useState('');
    const [shop, setShop] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);
    if (!demoShop) return null;

    const submit = async () => {
        if (busy) return;
        if (name.trim().length < 2 || shop.trim().length < 2 || phone.length !== 10) { setError(tr('Please fill in your name, your shop and a 10 digit mobile number.')); return; }
        setBusy(true); setError('');
        try {
            await api.post('/demo/lead', { name: name.trim(), shopName: shop.trim(), phone, language: lang, stories: useTutorialStore.getState().done, website: '' });
            setSent(true);
            useTutorialStore.getState().markLeadDone();
        } catch (e) {
            setError(e.response?.data?.error || tr('Could not send. Please try again.'));
        } finally { setBusy(false); }
    };
    const field = { borderWidth: 1, borderColor: border, backgroundColor: background, color: text, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 10 };

    return (
        <Sheet visible={open} onClose={close} title={tr('Did you like the demo?')}>
            {sent ? (
                <View style={{ alignItems: 'center', paddingVertical: 18 }}>
                    <Text style={{ color: text, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>{tr('Thank you! We will call you soon.')}</Text>
                    <Pressable onPress={close} style={{ marginTop: 18, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 14, backgroundColor: primary }}>
                        <Text style={{ color: onPrimary, fontWeight: '800' }}>{tr('Close')}</Text>
                    </Pressable>
                </View>
            ) : (
                <>
                    <Text style={{ color: muted, fontSize: 13, marginBottom: 14 }}>{tr('Leave your details and we will call you to talk about your shop. No spam.')}</Text>
                    <TextInput value={name} onChangeText={setName} placeholder={tr('Your name')} placeholderTextColor={muted} maxLength={80} style={field} />
                    <TextInput value={shop} onChangeText={setShop} placeholder={tr('Shop name')} placeholderTextColor={muted} maxLength={80} style={field} />
                    <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} placeholder={tr('Mobile number')} placeholderTextColor={muted} keyboardType="number-pad" maxLength={10} style={field} />
                    {error ? <Text style={{ color: '#C62828', marginBottom: 10 }}>{error}</Text> : null}
                    <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [{ paddingVertical: 14, borderRadius: 16, backgroundColor: primary, alignItems: 'center', opacity: pressed || busy ? 0.8 : 1 }]}>
                        {busy ? <ActivityIndicator color={onPrimary} /> : <Text style={{ color: onPrimary, fontSize: 16, fontWeight: '800' }}>{tr('Call me')}</Text>}
                    </Pressable>
                    <Pressable onPress={close} style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ color: muted, fontWeight: '700' }}>{tr('Not now')}</Text></Pressable>
                    <Text style={{ color: muted, fontSize: 11.5, textAlign: 'center', marginTop: 4, backgroundColor: surface }}>{tr('We keep your details only to call you. See our Privacy Policy.')}</Text>
                </>
            )}
        </Sheet>
    );
}
