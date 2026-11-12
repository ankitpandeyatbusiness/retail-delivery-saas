import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Hint } from '../../components/settingsForm';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { fetchDemo, saveDemo, switchDemo, removeDemo } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { dateTime } from '../../utils/format';
import { useSupreme } from '../../hooks/useSupreme';

// The private demo login: one number + OTP that opens ANY shop as a brand-new person (no real orders, payments or messages).
// For the owner, friends and Razorpay reviewers. No SMS is ever sent for it.
export default function DemoLoginScreen() {
    const t = useTheme();
    const supreme = useSupreme();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(false);

    const load = useCallback(async () => {
        try { const r = await fetchDemo(); setD(r); setPhone((p) => p || r.phone || ''); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!d) return <Screen title="Demo login" subtitle="For friends and reviewers">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const run = async (fn, ok) => {
        setBusy(true);
        try { const r = await fn(); setD(r); toast(ok); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(false); }
    };
    const save = () => run(async () => { const r = await saveDemo({ phone: phone.trim(), otp: otp.trim() }); setOtp(''); return r; }, 'Demo login saved');

    return (
        <Screen title="Demo login" subtitle="For friends and reviewers">
            <Hero section={d.enabled ? 'money' : 'alerts'} title={d.enabled ? 'Demo login is ON' : 'Demo login is OFF'} subtitle={d.enabled ? `Number ${d.phone} opens any shop as a new person.` : 'Nobody can use the demo number now.'} right={<Badge label={d.enabled ? 'ON' : 'OFF'} tone={d.enabled ? 'success' : 'neutral'} />}>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>
                    {d.logins ? `${d.logins} demo logins so far${d.lastLoginAt ? `, last ${dateTime(d.lastLoginAt)}` : ''}` : 'No demo login yet'}
                </Text>
            </Hero>

            {!supreme ? <Hint tone="warn">Only the supreme admin can change the demo login. You can look at it.</Hint> : (
                <>
                    <Card style={{ marginTop: spacing.lg }}>
                        <Field label="Demo mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="10 digit number" />
                        <Field label={d.hasOtp ? 'New OTP (6 digits)' : 'OTP (6 digits)'} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="Choose any 6 digits" secureTextEntry />
                    </Card>
                    <Button title={d.hasOtp ? 'Change number and OTP' : 'Save and switch on'} icon="ok" style={{ marginTop: spacing.lg }} disabled={busy || phone.length !== 10 || otp.length !== 6} onPress={save} />
                    {d.hasOtp ? (
                        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                            <Button style={{ flex: 1 }} kind="outline" title={d.enabled ? 'Switch off' : 'Switch on'} disabled={busy} onPress={() => run(() => switchDemo(!d.enabled), d.enabled ? 'Demo login is off' : 'Demo login is on')} />
                            <Button style={{ flex: 1 }} kind="outline" title="Remove" disabled={busy} onPress={() => setConfirm(true)} />
                        </View>
                    ) : null}
                </>
            )}

            <Hint>Open any shop, type this number, then the OTP. You see the shop as a brand-new person: no real customers, orders or money. A demo person cannot place a real order, pay, book or message anyone, and no SMS is ever sent. Every demo login is written in the audit log.</Hint>
            <Hint tone="warn">Change the OTP when Razorpay gives you live keys. The OTP is never shown again after you save it.</Hint>
            <ConfirmSheet visible={confirm} onClose={() => setConfirm(false)} title="Remove the demo login?" message="The number and OTP are deleted. Demo people who are signed in stay in their demo until they sign out." confirmLabel="Remove" danger onConfirm={() => run(removeDemo, 'Demo login removed')} />
        </Screen>
    );
}
