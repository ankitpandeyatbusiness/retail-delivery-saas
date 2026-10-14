import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Badge, Button, Chip } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Switch, Hint, Label } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, toast } from '../../components/feedback';
import { listOwnerMessages, getOwnerMessage, sendOwnerMessage } from '../../api/platformApi';
import { useShopsStore } from '../../store/useShopsStore';
import { errMsg } from '../../api/adminClient';
import { ago } from '../../utils/format';

const TONE = { done: 'success', sending: 'warn', queued: 'info', failed: 'danger' };

// A message from the platform to the owners of all shops, or of the shops you choose.
export default function OwnerMessagesScreen() {
    const t = useTheme();
    const shops = useShopsStore((s) => s.items);
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [compose, setCompose] = useState(false);
    const [form, setForm] = useState({ title: '', body: '', all: true, ids: [], sendEmail: false });
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(null);

    const load = useCallback(async () => {
        try { setItems((await listOwnerMessages()).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { if (compose && !shops.length) useShopsStore.getState().load(); }, [compose, shops.length]);

    useEffect(() => {
        if (!items?.some((m) => m.status === 'sending' || m.status === 'queued')) return undefined;
        const id = setInterval(load, 4000);
        return () => clearInterval(id);
    }, [items, load]);

    const send = async () => {
        if (!form.title.trim() || !form.body.trim()) { toast('Add a title and a message', 'error'); return; }
        if (!form.all && !form.ids.length) { toast('Choose at least one shop', 'error'); return; }
        setBusy(true);
        try {
            await sendOwnerMessage({
                title: form.title.trim(), body: form.body.trim(), kind: 'info', sendEmail: form.sendEmail,
                ...(form.all ? {} : { tenantIds: form.ids }),
            });
            toast('Sending…'); setCompose(false); setForm({ title: '', body: '', all: true, ids: [], sendEmail: false }); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const show = async (m) => { setOpen(m); try { setOpen(await getOwnerMessage(m.id)); } catch (e) { /* keep list data */ } };

    return (
        <Screen title="Messages to owners" subtitle="From the platform" right={<HeaderButton icon="send" onPress={() => setCompose(true)} />}>
            {items === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />) : !items.length ? (
                <Empty icon="megaphone" title="No messages sent yet" hint="Tell every shop owner about an update, or write to a few shops." action="Write a message" onAction={() => setCompose(true)} />
            ) : items.map((m) => (
                <Card key={String(m.id)} onPress={() => show(m)} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1, paddingRight: spacing.md }} numberOfLines={1}>{m.title}</Text>
                        <Badge label={m.status} tone={TONE[m.status] || 'neutral'} />
                    </View>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }} numberOfLines={2}>{m.body}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                        <Badge label={`${m.sent}/${m.recipients} shops`} tone="success" icon="shops" />
                        {m.failed ? <Badge label={`${m.failed} failed`} tone="danger" /> : null}
                        <Text style={{ color: t.muted, fontSize: font.xs }}>{ago(m.createdAt)}</Text>
                    </View>
                </Card>
            ))}

            <Sheet visible={compose} onClose={() => setCompose(false)} title="New message to owners">
                <Field label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} maxLength={120} />
                <Field label="Message" value={form.body} onChangeText={(v) => setForm({ ...form, body: v })} multiline maxLength={1000} hint={`${form.body.length}/1000`} />
                <Switch title="Every shop" subtitle="Switch off to choose shops" value={form.all} onValueChange={(v) => setForm({ ...form, all: v })} />
                {!form.all ? (
                    <View style={{ marginVertical: spacing.sm }}>
                        <Label>Shops ({form.ids.length} chosen)</Label>
                        <ScrollView style={{ maxHeight: 150 }}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                {shops.map((s) => (
                                    <View key={s._id} style={{ marginBottom: spacing.sm }}>
                                        <Chip label={s.name} active={form.ids.includes(s._id)} onPress={() => setForm({ ...form, ids: form.ids.includes(s._id) ? form.ids.filter((x) => x !== s._id) : [...form.ids, s._id] })} />
                                    </View>
                                ))}
                            </View>
                        </ScrollView>
                    </View>
                ) : null}
                <Switch title="Also send by email" value={form.sendEmail} onValueChange={(v) => setForm({ ...form, sendEmail: v })} last />
                <Hint>You can send 5 messages a day. Owners see it in their app notifications.</Hint>
                <Button title="Send message" icon="send" onPress={send} loading={busy} style={{ marginTop: spacing.md }} />
            </Sheet>

            <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.title || ''}>
                {open ? (
                    <>
                        <Text style={{ color: t.text, lineHeight: 22 }}>{open.body}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
                            <Badge label={open.status} tone={TONE[open.status] || 'neutral'} />
                            <Badge label={`${open.recipients} shops`} icon="shops" />
                            <Badge label={`${open.sent} sent`} tone="success" />
                            {open.failed ? <Badge label={`${open.failed} failed`} tone="danger" /> : null}
                        </View>
                        <Button title="Close" kind="outline" onPress={() => setOpen(null)} style={{ marginTop: spacing.lg }} />
                    </>
                ) : null}
            </Sheet>
        </Screen>
    );
}
