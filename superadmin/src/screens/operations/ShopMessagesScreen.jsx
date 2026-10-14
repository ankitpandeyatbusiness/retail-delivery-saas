import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Badge, Button } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Choice, Switch, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, toast } from '../../components/feedback';
import { listShopMessages, sendShopMessage, getShopMessage } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { ago } from '../../utils/format';

const AUDIENCE = [{ value: 'customers', label: 'Customers' }, { value: 'riders', label: 'Riders' }, { value: 'both', label: 'Both' }];
const KIND = [{ value: 'info', label: 'Information' }, { value: 'promo', label: 'Promotion' }];
const TONE = { done: 'success', sending: 'warn', queued: 'info', failed: 'danger' };

// Messages from a shop to its customers and riders (in the app, never by SMS). 5 a day per sender.
export default function ShopMessagesScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [compose, setCompose] = useState(false);
    const [form, setForm] = useState({ title: '', body: '', audience: 'customers', kind: 'info', sendEmail: false });
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(null);

    const load = useCallback(async () => {
        try { setItems((await listShopMessages(shopId)).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    // a message that is still being sent updates itself
    useEffect(() => {
        if (!items?.some((m) => m.status === 'sending' || m.status === 'queued')) return undefined;
        const id = setInterval(load, 4000);
        return () => clearInterval(id);
    }, [items, load]);

    const send = async () => {
        if (!form.title.trim()) { toast('Add a title', 'error'); return; }
        if (!form.body.trim()) { toast('Write the message', 'error'); return; }
        setBusy(true);
        try {
            await sendShopMessage(shopId, { ...form, title: form.title.trim(), body: form.body.trim() });
            toast('Sending…'); setCompose(false); setForm({ title: '', body: '', audience: 'customers', kind: 'info', sendEmail: false }); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const show = async (m) => {
        setOpen(m);
        try { setOpen(await getShopMessage(shopId, m.id)); } catch (e) { /* keep the list data */ }
    };

    return (
        <Screen title="Messages" subtitle={`To ${name}'s customers and riders`} right={<HeaderButton icon="send" onPress={() => setCompose(true)} />}>
            {items === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />) : !items.length ? (
                <Empty icon="megaphone" title="No messages sent yet" hint="Tell customers about a new dish or an offer, or tell riders about a change." action="Write a message" onAction={() => setCompose(true)} />
            ) : items.map((m) => (
                <Card key={String(m.id)} onPress={() => show(m)} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1, paddingRight: spacing.md }} numberOfLines={1}>{m.title}</Text>
                        <Badge label={m.status} tone={TONE[m.status] || 'neutral'} />
                    </View>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }} numberOfLines={2}>{m.body}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                        <Badge label={m.audience} icon="users" />
                        <Badge label={m.kind === 'promo' ? 'Promotion' : 'Information'} tone={m.kind === 'promo' ? 'warn' : 'info'} />
                        <Badge label={`${m.sent}/${m.recipients} sent`} tone="success" />
                        {m.failed ? <Badge label={`${m.failed} failed`} tone="danger" /> : null}
                    </View>
                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 6 }}>{ago(m.createdAt)}</Text>
                </Card>
            ))}

            <Sheet visible={compose} onClose={() => setCompose(false)} title="New message">
                <Choice label="Send to" options={AUDIENCE} value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} />
                <Choice label="Kind" options={KIND} value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} />
                <Field label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} maxLength={120} />
                <Field label="Message" value={form.body} onChangeText={(v) => setForm({ ...form, body: v })} multiline maxLength={1000} hint={`${form.body.length}/1000`} />
                <Switch title="Also send by email" value={form.sendEmail} onValueChange={(v) => setForm({ ...form, sendEmail: v })} last />
                <Hint>A promotion skips customers who switched promotions off. A shop can send 5 messages a day.</Hint>
                <Button title="Send message" icon="send" onPress={send} loading={busy} style={{ marginTop: spacing.md }} />
            </Sheet>

            <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.title || ''}>
                {open ? (
                    <>
                        <Text style={{ color: t.text, lineHeight: 22 }}>{open.body}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
                            <Badge label={open.status} tone={TONE[open.status] || 'neutral'} />
                            <Badge label={`${open.recipients} people`} icon="users" />
                            <Badge label={`${open.sent} sent`} tone="success" />
                            {open.failed ? <Badge label={`${open.failed} failed`} tone="danger" /> : null}
                            {open.skippedOptOut ? <Badge label={`${open.skippedOptOut} opted out`} /> : null}
                        </View>
                        <Button title="Close" kind="outline" onPress={() => setOpen(null)} style={{ marginTop: spacing.lg }} />
                    </>
                ) : null}
            </Sheet>
        </Screen>
    );
}
