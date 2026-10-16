// Add or change the owner's email in two steps: type the address, then type the 6-digit code mailed to it. The address is
// saved only when the code is right, so the bills and documents the platform sends can really be received.
//   required: cannot be closed (the email is needed).   onDone(profile): called once the address is saved.
import React, { useEffect, useRef, useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { Sheet, Button, Field } from './ui';
import { useBrand } from '../common/kit';
import { sendEmailCode, verifyEmailCode, apiError } from '../../api/owners/shopApi';
import { useAuthStore } from '../../store/common/useAuthStore';
import { showToast } from '../customers/shop';

const OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EmailVerifySheet({ visible, required, title, intro, onClose, onDone }) {
    const { muted, error, primary, text } = useBrand();
    const [step, setStep] = useState('email');   // email | code
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');
    const [wait, setWait] = useState(0);         // seconds until another code may be asked for
    const [devCode, setDevCode] = useState('');  // only a test setup returns the code; a real one never does
    const timer = useRef(null);

    useEffect(() => { if (visible) { setStep('email'); setCode(''); setProblem(''); setDevCode(''); } }, [visible]);
    useEffect(() => {
        if (wait <= 0) return undefined;
        timer.current = setTimeout(() => setWait((w) => w - 1), 1000);
        return () => clearTimeout(timer.current);
    }, [wait]);

    const send = async () => {
        const e = email.trim().toLowerCase();
        if (!OK.test(e)) { setProblem('Enter a valid email, like name@example.com'); return; }
        setBusy(true); setProblem('');
        try {
            const r = await sendEmailCode(e);
            setEmail(e); setStep('code'); setCode(''); setWait(r.resendInSec || 30); setDevCode(r.devCode || '');
        } catch (er) { setProblem(apiError(er)); } finally { setBusy(false); }
    };

    const confirm = async (value = code) => {
        if (!/^\d{6}$/.test(value)) { setProblem('Enter the 6-digit code'); return; }
        setBusy(true); setProblem('');
        try {
            const u = await verifyEmailCode(email, value);
            useAuthStore.setState((st) => (st.user ? { user: { ...st.user, email: u.email } } : {}));
            showToast('Email confirmed. Your bills will come here.');
            if (onDone) onDone(u);
        } catch (er) { setProblem(apiError(er)); setCode(''); } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={required ? () => { } : onClose} title={title || (step === 'email' ? 'Your email' : 'Enter the code')}>
            {step === 'email' ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 12, lineHeight: 20 }}>{intro || 'We send your monthly bills, receipts and official documents to your email. We will mail you a code to confirm it is yours.'}</Text>
                    <Field value={email} onChangeText={(x) => { setEmail(x); setProblem(''); }} placeholder="name@example.com" keyboardType="email-address" maxLength={120} autoFocus style={{ marginBottom: 6 }} />
                    {problem ? <Text style={{ color: error, marginBottom: 8 }}>{problem}</Text> : null}
                    <Button label="Send me a code" icon="mail" busy={busy} onPress={send} style={{ marginTop: 8 }} />
                </View>
            ) : (
                <View>
                    <Text style={{ color: muted, marginBottom: 12, lineHeight: 20 }}>We sent a 6-digit code to <Text style={{ color: text, fontWeight: '800' }}>{email}</Text>. It works for 10 minutes. Check your spam folder if you do not see it.</Text>
                    <Field
                        value={code}
                        onChangeText={(x) => { const d = x.replace(/\D/g, '').slice(0, 6); setCode(d); setProblem(''); if (d.length === 6) confirm(d); }}
                        placeholder="6-digit code" keyboardType="number-pad" maxLength={6} autoFocus style={{ marginBottom: 6, textAlign: 'center', fontSize: 22, letterSpacing: 6 }}
                    />
                    {devCode ? <Text style={{ color: muted, fontSize: 12, textAlign: 'center' }}>Test setup: the code is {devCode}</Text> : null}
                    {problem ? <Text style={{ color: error, marginVertical: 6 }}>{problem}</Text> : null}
                    <Button label="Confirm" icon="checkmark" busy={busy} onPress={() => confirm()} style={{ marginTop: 8 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
                        <Pressable onPress={() => { setStep('email'); setProblem(''); }} hitSlop={8}><Text style={{ color: primary, fontWeight: '800' }}>Change the email</Text></Pressable>
                        <Pressable onPress={wait > 0 || busy ? undefined : send} hitSlop={8}><Text style={{ color: wait > 0 ? muted : primary, fontWeight: '800' }}>{wait > 0 ? `Send again in ${wait}s` : 'Send again'}</Text></Pressable>
                    </View>
                </View>
            )}
        </Sheet>
    );
}
