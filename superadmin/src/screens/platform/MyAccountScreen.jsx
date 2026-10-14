import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, ListRow, SectionTitle } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import ProfileCard from '../../components/ProfileCard';
import { Field } from '../../components/inputs';
import { Hint } from '../../components/settingsForm';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import { fetchTeam, renameSuperadmin } from '../../api/teamApi';
import { sendOtp } from '../../api/authApi';
import { changeMyPhones } from '../../api/platformApi';
import { enablePush, pushStatus } from '../../utils/push';
import { errMsg } from '../../api/adminClient';
import { useAuthStore } from '../../store/useAuthStore';

const PHONE_RE = /^[6-9]\d{9}$/;
const REASON = {
    permission: 'Notifications are not allowed for this app. Allow them in the phone settings.',
    token: 'The phone did not give a push address. Try again in a minute.',
    unavailable: 'This build of the app has no Firebase set up, so push alerts cannot start. Add google-services.json and rebuild.',
};

// Your own account: name, the numbers you log in with, and alerts on this phone.
export default function MyAccountScreen() {
    const t = useTheme();
    const [me, setMe] = useState(null);
    const [error, setError] = useState('');
    const [push, setPush] = useState(null);
    const [sheet, setSheet] = useState(null);     // name | phones
    const [name, setName] = useState('');
    const [step, setStep] = useState(1);
    const [p1, setP1] = useState('');
    const [p2, setP2] = useState('');
    const [verify, setVerify] = useState('');
    const [otp, setOtp] = useState('');
    const [busy, setBusy] = useState('');
    const [pushMsg, setPushMsg] = useState('');

    const load = useCallback(async () => {
        try {
            const r = await fetchTeam();
            setMe(r.items.find((a) => a.isMe) || null);
            setError('');
        } catch (e) { setError(errMsg(e)); }
        setPush(await pushStatus());
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!me) return <Screen title="My account">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const startPhones = () => {
        setP1(me.phones?.[0] || ''); setP2(me.phones?.[1] || ''); setVerify(me.phones?.[0] || ''); setOtp(''); setStep(1); setSheet('phones');
    };
    const newPhones = [p1, p2].filter(Boolean);

    const sendCode = async () => {
        if (!newPhones.length || !newPhones.every((p) => PHONE_RE.test(p))) { toast('Enter valid 10-digit numbers', 'error'); return; }
        if (newPhones.length === 2 && newPhones[0] === newPhones[1]) { toast('The two numbers are the same', 'error'); return; }
        setBusy('send');
        try { await sendOtp(verify); setOtp(''); setStep(2); toast(`Code sent to ${verify}`); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };
    const confirm = async () => {
        if (!/^\d{6}$/.test(otp)) { toast('Enter the 6-digit code', 'error'); return; }
        setBusy('confirm');
        try {
            await changeMyPhones({ phones: newPhones, verifyPhone: verify, otp });
            toast('Login numbers changed'); setSheet(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };
    const turnOnPush = async () => {
        setBusy('push');
        const r = await enablePush({ ask: true });
        setPushMsg(r.ok ? '' : REASON[r.reason] || REASON.unavailable);
        if (r.ok) toast('Alerts are on for this phone');
        setPush(await pushStatus());
        setBusy('');
    };

    return (
        <Screen title="My account" subtitle="Superadmin" refreshing={false} onRefresh={load}>
            <ProfileCard name={me.name} subtitle={me.phones?.join(' · ')} />

            <SectionTitle section="settings">Account</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="edit" title="Name" subtitle={me.name || 'Not set'} onPress={() => { setName(me.name || ''); setSheet('name'); }} />
                <ListRow section="platform" icon="phone" title="Login numbers" subtitle={`${me.phones?.join(' · ')} · proof with a code`} onPress={startPhones} last />
            </Card>

            <SectionTitle section="alerts">Alerts on this phone</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>Push notifications</Text>
                    <Badge label={push?.registered ? 'On' : 'Off'} tone={push?.registered ? 'success' : 'neutral'} />
                </View>
                <Text style={{ color: t.muted, marginTop: 4 }}>Late orders and unpaid bills reach this phone even when the app is closed.</Text>
                {pushMsg ? <Text style={{ color: t.warn, marginTop: spacing.sm, fontSize: font.sm }}>{pushMsg}</Text> : null}
                {push?.permission === 'denied' && !push.canAsk ? (
                    <Button title="Open phone settings" kind="outline" small style={{ marginTop: spacing.md }} onPress={() => Linking.openSettings()} />
                ) : (
                    <Button title={push?.registered ? 'Register this phone again' : 'Turn on alerts'} icon="bell" kind="soft" small loading={busy === 'push'} style={{ marginTop: spacing.md }} onPress={turnOnPush} />
                )}
            </Card>

            <Sheet visible={sheet === 'name'} onClose={() => setSheet(null)} title="Your name">
                <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
                <Button
                    title="Save"
                    loading={busy === 'name'}
                    onPress={async () => {
                        setBusy('name');
                        try { await renameSuperadmin(me.id, name.trim()); useAuthStore.setState((s) => ({ admin: { ...(s.admin || {}), name: name.trim() } })); toast('Saved'); setSheet(null); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
                    }}
                />
            </Sheet>

            <Sheet visible={sheet === 'phones'} onClose={() => setSheet(null)} title="Change login numbers">
                {step === 1 ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.md }}>One or two numbers can log in as you. A code is sent to one of your CURRENT numbers to confirm it is you.</Text>
                        <Field label="Number 1" value={p1} onChangeText={(v) => setP1(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                        <Field label="Number 2 (optional)" value={p2} onChangeText={(v) => setP2(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                        {me.phones?.length > 1 ? (
                            <View style={{ marginBottom: spacing.md }}>
                                <Text style={{ color: t.text, fontWeight: '700', marginBottom: 6 }}>Send the code to</Text>
                                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                    {me.phones.map((p) => <Button key={p} small kind={verify === p ? 'primary' : 'outline'} title={p} onPress={() => setVerify(p)} />)}
                                </View>
                            </View>
                        ) : <Hint>The code goes to {me.phones?.[0]}.</Hint>}
                        <Button title="Send code" icon="send" loading={busy === 'send'} onPress={sendCode} />
                    </>
                ) : (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.md }}>Enter the 6-digit code sent to {verify}.</Text>
                        <Field label="Code" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoFocus />
                        <Button title="Confirm and change" loading={busy === 'confirm'} onPress={confirm} />
                        <Button title="Back" kind="outline" onPress={() => setStep(1)} style={{ marginTop: spacing.sm }} />
                    </>
                )}
            </Sheet>
        </Screen>
    );
}
