import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Badge, Card } from '../../components/ui';
import { Group, TextField, Switch, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { smsProvider, saveSmsProvider } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

const TEMPLATE_KEY = /^[a-z0-9_]{1,40}$/;

// Lets a shop send SMS with its OWN DLT sender and provider account. Keys can be set, never read back.
export default function SmsProviderScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [f, setF] = useState(null);
    const [hasKeys, setHasKeys] = useState(false);
    const [authKey, setAuthKey] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const r = await smsProvider(shopId);
            setF({
                templateId: r.templateId || '',
                enabled: !!r.own.enabled, senderId: r.own.senderId || '', entityId: r.own.entityId || '',
                templates: Object.entries(r.own.templateIds || {}).map(([key, value]) => ({ key, value: String(value) })),
            });
            setHasKeys(!!r.own.hasKeys); setError('');
        } catch (e) { setError(errMsg(e)); }
    };
    useEffect(() => { load(); }, [shopId]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!f) return <Screen title="SMS sender" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

    const save = async () => {
        for (const x of f.templates) {
            if (!TEMPLATE_KEY.test(x.key) || !/^\d{10,25}$/.test(x.value)) { toast(`Template "${x.key || '?'}": use a name like order_new and the DLT number`, 'error'); return; }
        }
        setBusy(true);
        try {
            const own = {
                enabled: f.enabled,
                senderId: f.senderId.trim() || null,
                entityId: f.entityId.trim() || null,
                templateIds: Object.fromEntries(f.templates.map((x) => [x.key, x.value])),
                ...(authKey.trim() ? { authKey: authKey.trim() } : {}),
            };
            await saveSmsProvider(shopId, { templateId: f.templateId.trim() || null, own });
            toast('SMS sender saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="SMS sender" subtitle={name} footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}>
            <Group title="Platform sender" section="platform" hint="Used when the shop does not send with its own sender.">
                <TextField label="DLT template number (optional)" value={f.templateId} onChange={set('templateId')} keyboardType="number-pad" maxLength={25} last />
            </Group>

            <Group title="The shop's own sender" section="settings">
                <Switch title="Use the shop's own SMS account" subtitle="The shop pays its provider itself. No wallet charge." value={f.enabled} onValueChange={set('enabled')} />
                <View style={{ height: spacing.md }} />
                <TextField label="Sender id (6 letters)" value={f.senderId} onChange={(v) => set('senderId')(v.toUpperCase())} maxLength={6} autoCapitalize="characters" />
                <TextField label="DLT entity number" value={f.entityId} onChange={set('entityId')} keyboardType="number-pad" maxLength={25} />
                <TextField
                    label={hasKeys ? 'Provider key (leave empty to keep the saved one)' : 'Provider key'}
                    value={authKey}
                    onChange={setAuthKey}
                    autoCapitalize="none"
                    last
                />
                <View style={{ marginTop: spacing.md }}><Badge label={hasKeys ? 'A key is saved' : 'No key saved'} tone={hasKeys ? 'success' : 'neutral'} icon={hasKeys ? 'ok' : 'lock'} /></View>
            </Group>

            <Group title="Templates" section="catalog" hint="A name for each message (for example otp, order_new) and its DLT template number. Up to 30.">
                {f.templates.map((x, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.sm }}>
                        <View style={{ flex: 1 }}><TextField label={i === 0 ? 'Name' : undefined} value={x.key} onChange={(v) => setF((s) => ({ ...s, templates: s.templates.map((y, n) => (n === i ? { ...y, key: v.toLowerCase() } : y)) }))} autoCapitalize="none" last /></View>
                        <View style={{ flex: 1.2 }}><TextField label={i === 0 ? 'DLT number' : undefined} value={x.value} onChange={(v) => setF((s) => ({ ...s, templates: s.templates.map((y, n) => (n === i ? { ...y, value: v.replace(/\D/g, '') } : y)) }))} keyboardType="number-pad" last /></View>
                        <Pressable onPress={() => setF((s) => ({ ...s, templates: s.templates.filter((_, n) => n !== i) }))} hitSlop={8} style={{ height: 48, width: 36, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="trash" size={20} color={t.danger} />
                        </Pressable>
                    </View>
                ))}
                {f.templates.length < 30 ? <Button title="Add a template" kind="soft" small icon="add" onPress={() => setF((s) => ({ ...s, templates: [...s.templates, { key: '', value: '' }] }))} /> : null}
                <Hint>To switch the shop's own sender on, save the sender id, entity number, key and at least one template first.</Hint>
            </Group>
        </Screen>
    );
}
