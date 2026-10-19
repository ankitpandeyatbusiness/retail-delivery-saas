// Messages: send a notification to all your customers and/or riders, and see what you sent. 5 messages a day. Never by SMS.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Button, Pill, Sheet, Field, Chips, SectionTitle, Empty } from '../../components/owners/ui';
import { ToggleRow, Label, Hint } from '../../components/owners/menuBits';
import { fetchMessages, sendMessage, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { MESSAGE_STATUS, AUDIENCES } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

function Compose({ visible, onClose, onSent }) {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState('customers');
    const [kind, setKind] = useState('info');
    const [busy, setBusy] = useState(false);
    const ok = title.trim().length >= 1 && body.trim().length >= 1;

    const send = async () => {
        const who = AUDIENCES.find((a) => a[0] === audience)[1].toLowerCase();
        const yes = await ask({ title: tr('Send this message?'), message: tr('It goes to all your {who} now. It cannot be taken back.', { who: who }), confirmText: tr('Send') });
        if (!yes) return;
        setBusy(true);
        try {
            await sendMessage({ title: title.trim(), body: body.trim(), audience, kind });
            showToast(tr('Sending. It reaches everyone in a few minutes.'));
            setTitle(''); setBody('');
            onSent(); onClose();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={tr('New message')}>
            <Label>{tr('Send to')}</Label>
            <Chips options={AUDIENCES} value={audience} onChange={(a) => { setAudience(a); if (a !== 'customers') setKind('info'); }} style={{ marginTop: 0 }} />
            <Label hint={kind === 'promo' ? tr('Customers who turned promotions off are skipped.') : tr('Important news, like closing for a day.')}>{tr('Kind')}</Label>
            <Chips options={audience === 'customers' ? [['info', 'Information'], ['promo', 'Offer']] : [['info', 'Information']]} value={kind} onChange={setKind} style={{ marginTop: 0 }} />
            <View style={{ height: 6 }} />
            <Field value={title} onChangeText={setTitle} placeholder={tr('Title (shown in bold)')} maxLength={120} style={{ marginBottom: 10 }} />
            <Field value={body} onChangeText={setBody} placeholder={tr('Message')} multiline maxLength={1000} style={{ marginBottom: 6 }} />
            <Hint>{tr('It reaches people as a notification and in their app inbox.')}</Hint>
            <View style={{ height: 12 }} />
            <Button label={tr('Send message')} icon="send" disabled={!ok} busy={busy} onPress={send} />
        </Sheet>
    );
}

export default function OwnerMessagesScreen() {
    const { background, text, muted, ok, error, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const [writing, setWriting] = useState(false);

    const load = useCallback(async () => {
        try { setItems((await fetchMessages()).items); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your messages.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => {
        load();
        const t = setInterval(load, 8000);   // progress of a message that is still sending
        return () => clearInterval(t);
    }, [load]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Messages')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
                    <Button label={tr('New message')} icon="create" onPress={() => setWriting(true)} />
                    <Hint>{tr('Up to 5 messages a day. They arrive as notifications in the app.')}</Hint>
                </View>
                <SectionTitle title={tr('Sent')} />
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="megaphone-outline" title={tr('No messages yet')} hint={tr('Tell your customers about a new dish, an offer or a holiday.')} /> : null}
                {(items || []).map((m) => (
                    <Card key={m.id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', flex: 1 }} numberOfLines={1}>{m.title}</Text>
                            <Pill label={MESSAGE_STATUS[m.status] || m.status} color={m.status === 'failed' ? error : m.status === 'done' ? ok : primary} />
                        </View>
                        <Text style={{ color: muted, marginTop: 4 }} numberOfLines={3}>{m.body}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('To {v1} · {ago} {v3}{v4}{v5}', { v1: m.audience === 'both' ? 'customers and riders' : m.audience, ago: ago(m.createdAt), v3: ` · ${m.sent}/${m.recipients} delivered`, v4: m.failed ? ` · ${m.failed} failed` : '', v5: m.skippedOptOut ? ` · ${m.skippedOptOut} skipped (promotions off)` : '' })}</Text>
                    </Card>
                ))}
            </ScrollView>
            <Compose visible={writing} onClose={() => setWriting(false)} onSent={load} />
        </View>
    );
}
