import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle, KeyValue } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Hint, Label } from '../../components/settingsForm';
import { Hero, SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { platformPaymentStatus, savePlatformKeys, newPlatformWebhookSecret, testPlatformPayments } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { dateTime, titleCase } from '../../utils/format';

const STEP = {
    keys_saved: 'Razorpay keys saved',
    connection_tested: 'Connection tested',
    webhook_secret_created: 'Webhook secret created',
    webhook_event_received: 'Webhook event received',
};
const SOURCE = { saved: 'Saved in this app', env: 'From the server .env file', none: 'Not set' };

// YOUR Razorpay account: it receives the SMS top-ups and the monthly rent paid by shops.
export default function MyRazorpayScreen() {
    const t = useTheme();
    const [st, setSt] = useState(null);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);       // keys | secret
    const [keys, setKeys] = useState({ keyId: '', keySecret: '' });
    const [secret, setSecret] = useState(null);
    const [busy, setBusy] = useState('');
    const [confirm, setConfirm] = useState(false);

    const load = useCallback(async () => {
        try { setSt(await platformPaymentStatus()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!st) return <Screen title="My Razorpay" subtitle="SMS top-ups and rent">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const done = st.checklist.filter((c) => c.done).length;
    const ready = done === st.checklist.length;

    return (
        <Screen title="My Razorpay" subtitle="SMS top-ups and rent" refreshing={false} onRefresh={load}>
            <Hero
                section={ready ? 'money' : 'platform'}
                title={ready ? 'Your account is ready' : 'Set up your account'}
                subtitle={`${done} of ${st.checklist.length} steps done`}
                right={st.keyMode ? <Badge label={st.keyMode === 'live' ? 'Live keys' : 'Test keys'} tone={st.keyMode === 'live' ? 'success' : 'warn'} /> : null}
            >
                {st.warnings?.map((w) => <Text key={w} style={{ color: t.warn, fontSize: font.sm, marginTop: spacing.sm }}>• {w}</Text>)}
            </Hero>

            <SectionTitle section="money">Steps</SectionTitle>
            <Card>
                {st.checklist.map((c, i) => (
                    <View key={c.step} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                        <Icon name={c.done ? 'ok' : 'clock'} size={22} color={c.done ? t.success : t.muted} filled={c.done} />
                        <Text style={{ flex: 1, marginLeft: spacing.md, color: t.text, fontWeight: c.done ? '700' : '500' }}>{STEP[c.step] || titleCase(c.step)}</Text>
                    </View>
                ))}
            </Card>

            <SectionTitle section="settings">Your account</SectionTitle>
            <Card>
                <KeyValue label="Key ID" value={st.keyId || 'Not set'} />
                <KeyValue label="Keys come from" value={SOURCE[st.source]} />
                <KeyValue label="Last tested" value={st.verifiedAt ? dateTime(st.verifiedAt) : 'Not yet'} />
                <KeyValue label="Last webhook" value={st.lastWebhookAt ? dateTime(st.lastWebhookAt) : 'None yet'} last />
                <View style={{ height: spacing.md }} />
                <Button title={st.keyId ? 'Change my Razorpay keys' : 'Save my Razorpay keys'} icon="key" kind="soft" onPress={() => { setKeys({ keyId: '', keySecret: '' }); setSheet('keys'); }} />
                <Button title="Create webhook secret" icon="lock" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => setConfirm(true)} />
                <Button
                    title="Test the connection"
                    icon="bolt"
                    kind="outline"
                    style={{ marginTop: spacing.sm }}
                    loading={busy === 'test'}
                    disabled={!st.hasKeySecret}
                    onPress={async () => {
                        setBusy('test');
                        try { setSt(await testPlatformPayments()); toast('Connection works'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
                    }}
                />
            </Card>

            <SectionTitle section="platform">Put this in Razorpay</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>
                    In YOUR Razorpay dashboard: Settings → Webhooks → Add. Paste this address and the secret from "Create webhook secret".
                </Text>
                <Label>Webhook address</Label>
                <Text selectable style={{ color: t.text, fontWeight: '700', marginBottom: spacing.md }}>{st.webhookUrl}</Text>
                <Label>Events to tick</Label>
                <Text selectable style={{ color: t.muted, fontSize: font.sm }}>{[...(st.events || []), ...(st.disputeEvents || [])].join('\n')}</Text>
            </Card>
            <Hint>Shops pay their rent and buy SMS credit into this account. Each shop's own order payments go to that shop's own Razorpay account (Shop → Online payments).</Hint>

            <Sheet visible={sheet === 'keys'} onClose={() => setSheet(null)} title="My Razorpay keys">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>From your Razorpay dashboard (Account & Settings → API keys). The secret is saved encrypted and can never be read back.</Text>
                <Field label="Key ID" value={keys.keyId} onChangeText={(v) => setKeys({ ...keys, keyId: v.trim() })} autoCapitalize="none" placeholder="rzp_live_xxxxxxxx" />
                <Field label="Key secret" value={keys.keySecret} onChangeText={(v) => setKeys({ ...keys, keySecret: v.trim() })} autoCapitalize="none" secureTextEntry />
                <Hint tone="warn">New keys must be tested again before you rely on them.</Hint>
                <Button
                    title="Save keys"
                    loading={busy === 'keys'}
                    disabled={!keys.keyId || !keys.keySecret}
                    style={{ marginTop: spacing.md }}
                    onPress={async () => {
                        setBusy('keys');
                        try {
                            setSt(await savePlatformKeys({ keyId: keys.keyId, keySecret: keys.keySecret }));
                            toast('Keys saved. Test the connection next.');
                            setSheet(null);
                        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
                    }}
                />
            </Sheet>

            <ConfirmSheet
                visible={confirm}
                onClose={() => setConfirm(false)}
                title="Create a new webhook secret?"
                message="It is shown ONLY ONCE. Until you paste the new secret into Razorpay, paid bills and top-ups will not be marked paid by themselves."
                confirmLabel="Create"
                onConfirm={async () => {
                    try { const r = await newPlatformWebhookSecret(); setSecret(r); setSheet('secret'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />

            <Sheet visible={sheet === 'secret'} onClose={() => setSheet(null)} title="Webhook secret">
                {secret ? (
                    <>
                        <Text style={{ color: t.warn, fontWeight: '800', marginBottom: spacing.md }}>Copy these now. The secret is not shown again.</Text>
                        <Label>Webhook URL</Label>
                        <Text selectable style={{ color: t.text, marginBottom: spacing.md }}>{secret.webhookUrl}</Text>
                        <Label>Secret</Label>
                        <Text selectable style={{ color: t.text, fontWeight: '800', fontSize: font.lg, marginBottom: spacing.md }}>{secret.secret}</Text>
                        <Label>Events to tick in Razorpay</Label>
                        <Text selectable style={{ color: t.muted, fontSize: font.sm }}>{[...(secret.events || []), ...(secret.disputeEvents || [])].join('\n')}</Text>
                        <Button title="Done" kind="outline" onPress={() => { setSecret(null); setSheet(null); }} style={{ marginTop: spacing.lg }} />
                    </>
                ) : null}
            </Sheet>
        </Screen>
    );
}
