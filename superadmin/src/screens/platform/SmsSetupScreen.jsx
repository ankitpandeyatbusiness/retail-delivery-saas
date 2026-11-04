import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchSmsSetup, saveSmsSetup, testSms } from '../../api/handledApi';
import { errMsg } from '../../api/adminClient';
import { ago } from '../../utils/format';

const WHERE = { server: 'Set on the server', saved: 'Saved here', missing: 'Not set' };
const TONE = { server: 'info', saved: 'success', missing: 'warn' };

// Your SMS provider (MSG91) and DLT setup, in the app instead of the server: sender ID, entity ID, auth key, one template ID per text.
// A value set on the server always wins and is shown as such. Only the supreme admin can change anything here.
export default function SmsSetupScreen() {
    const t = useTheme();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [f, setF] = useState({});
    const [ids, setIds] = useState({});
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);

    const load = useCallback(async () => {
        try { const r = await fetchSmsSetup(); setD(r); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const save = async () => {
        const body = {};
        for (const k of ['senderId', 'entityId', 'defaultTemplateId', 'brandName', 'authKey']) if (f[k] !== undefined) body[k] = f[k];
        const tid = Object.fromEntries(Object.entries(ids).filter(([, v]) => v !== undefined));
        if (Object.keys(tid).length) body.templateIds = tid;
        if (!Object.keys(body).length) { toast('Nothing changed'); return; }
        setBusy(true);
        try { setD(await saveSmsSetup(body)); setF({}); setIds({}); toast('Saved'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const test = async () => {
        setTesting(true);
        try { const r = await testSms(phone); toast(r.ok ? r.note : `Failed: ${r.note}`, r.ok ? 'ok' : 'error'); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setTesting(false); }
    };

    const row = (label, key, item, hint, secret) => (
        <View>
            <Field label={label} value={f[key] !== undefined ? f[key] : (secret ? '' : item.value)} onChangeText={(v) => setF((x) => ({ ...x, [key]: v }))} placeholder={secret ? (item.set ? `Saved (${item.hint}). Type to replace` : 'Paste the auth key') : undefined} secureTextEntry={!!secret} autoCapitalize="none" hint={hint} editable={item.source !== 'server'} />
            <Badge label={WHERE[item.source]} tone={TONE[item.source]} />
        </View>
    );

    return (
        <Screen title="SMS and DLT setup" subtitle="MSG91 sender, entity and template IDs" onRefresh={load}>
            {!d ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />) : (
                <>
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={{ color: d.ready ? t.success : t.warn, fontWeight: '800', fontSize: font.md }}>{d.mock ? 'Mock mode: SMS are only printed in the server console' : d.ready ? 'Ready to send real SMS' : 'Not ready: add the auth key, sender ID and entity ID'}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>{d.missing ? `${d.missing} of ${d.templates.length} texts have no template ID yet.` : 'Every text has a template ID.'} A value set on the server (the .env) always wins.</Text>
                    </Card>

                    <Group title="Provider" section="platform">
                        {row('Auth key (MSG91)', 'authKey', d.authKey, 'From MSG91: API, auth key. Kept encrypted and never shown again.', true)}
                        {row('Sender ID (6 letters)', 'senderId', d.senderId, 'The header you registered on DLT.')}
                        {row('Entity ID', 'entityId', d.entityId, 'The principal entity ID from DLT.')}
                        {row('Default template ID (optional)', 'defaultTemplateId', d.defaultTemplateId, 'Used for any text that has no template ID of its own, like your alert to your phone.')}
                        {row('Name for the superadmin login OTP', 'brandName', d.brandName, 'Shown where the shop name goes when you log in yourself.')}
                    </Group>

                    <Group title="Template ID of every text" section="catalog">
                        <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>Register each text exactly as shown on DLT, then paste its template ID. The text with the shop name or numbers uses the same words as the app sends.</Text>
                        {d.templates.map((tp) => (
                            <View key={tp.key} style={{ marginBottom: spacing.md }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{tp.name}</Text>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{tp.text}</Text>
                                <Field label="Template ID" value={ids[tp.key] !== undefined ? ids[tp.key] : tp.templateId} onChangeText={(v) => setIds((x) => ({ ...x, [tp.key]: v }))} autoCapitalize="none" editable={tp.source !== 'server'} />
                                <Badge label={WHERE[tp.source]} tone={TONE[tp.source]} />
                            </View>
                        ))}
                    </Group>

                    <Button title="Save" icon="check" onPress={save} loading={busy} style={{ marginTop: spacing.md }} />

                    <Group title="Send a test SMS" section="alerts">
                        <Field label="Your mobile number" value={phone} onChangeText={setPhone} keyboardType="number-pad" maxLength={10} placeholder="10 digits" hint="Sends a real login OTP text, so you see the registered wording arrive. It costs one SMS." />
                        <Button title="Send test" kind="outline" icon="send" onPress={test} loading={testing} disabled={phone.length !== 10} />
                        {d.lastTest ? <Text style={{ color: d.lastTest.ok ? t.success : t.danger, fontSize: font.sm, marginTop: spacing.sm }}>Last test {ago(d.lastTest.at)} to {d.lastTest.to}: {d.lastTest.note}</Text> : null}
                    </Group>
                </>
            )}
        </Screen>
    );
}
