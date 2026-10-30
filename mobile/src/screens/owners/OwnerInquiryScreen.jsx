// One inquiry: who sent it, what they answered, the conversation, and the buttons to reply, call, WhatsApp and move it along.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Button, Card, Empty, Chips } from '../../components/owners/ui';
import { FormPage, Group, TextBox } from '../../components/owners/menuBits';
import { Answers, Bubbles, ReplyBox, STATUS_LABEL } from '../../components/common/InquiryThread';
import { inquiries as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const digits = (p) => String(p || '').replace(/\D/g, '');
const intl = (p) => { const d = digits(p); return d.length === 10 ? `91${d}` : d; };
const STEPS = ['quoted', 'confirmed', 'rejected', 'closed'];

export default function OwnerInquiryScreen() {
    const { id } = useRoute().params || {};
    const { text, muted, border, surface } = useBrand();
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const [note, setNote] = useState('');

    const load = useCallback(() => api.get(id).then((r) => { setI(r); setNote((n) => (n === '' ? r.note || '' : n)); setErr(''); })
        .catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this inquiry.')); }), [id]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onNotification((n) => { if (n?.type === 'inquiry_customer_reply' && String(n?.data?.inquiryId) === String(id)) load(); }), [id, load]);

    if (!i) return <FormPage title={tr('Inquiry')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;

    const send = async (t) => {
        try { setI(await api.reply(id, { text: t })); } catch (e) { showToast(apiError(e)); throw e; }
    };
    const setStatus = async (status) => {
        try { setI(await api.update(id, { status })); showToast(tr('Marked {s}', { s: tr(STATUS_LABEL[status]) })); } catch (e) { showToast(apiError(e)); }
    };
    const saveNote = async () => { try { await api.update(id, { note }); showToast(tr('Note saved')); } catch (e) { showToast(apiError(e)); } };

    return (
        <FormPage title={i.name} footer={<ReplyBox onSend={send} placeholder={tr('Reply to {n}', { n: i.name })} />}>
            <Card style={{ marginHorizontal: 0 }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{i.serviceName}</Text>
                <Text style={{ color: muted, marginTop: 2 }}>{i.name} · {i.phone}</Text>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    <Button label={tr('Call')} icon="call" iconOnly onPress={() => Linking.openURL(`tel:${digits(i.phone)}`)} style={{ flex: 1, marginRight: 8 }} />
                    <Button label="WhatsApp" icon="logo-whatsapp" iconOnly kind="ghost" onPress={() => Linking.openURL(`https://wa.me/${intl(i.phone)}`)} style={{ flex: 1 }} />
                </View>
            </Card>
            {i.answers?.length || i.estimate ? <Group title={tr('Their answers')}><Answers answers={i.answers} estimate={i.estimate} /></Group> : null}
            <Group title={tr('Conversation')}><Bubbles messages={i.messages} side="owner" /></Group>
            {i.quickReplies?.length ? (
                <Group title={tr('Quick replies')} hint={tr('Tap one to send it now.')}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {i.quickReplies.map((q) => (
                            <Pressable key={q} onPress={() => send(q).catch(() => { })} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                <Text style={{ color: text, fontSize: 13 }}>{q}</Text>
                            </Pressable>
                        ))}
                    </View>
                </Group>
            ) : null}
            <Group title={tr('Where it stands')} hint={tr('Now: {s}', { s: tr(STATUS_LABEL[i.status]) })}>
                <Chips options={STEPS.map((s) => [s, tr(STATUS_LABEL[s])])} value={i.status} onChange={setStatus} />
            </Group>
            <Group title={tr('Private note')} hint={tr('Only you can see this.')}>
                <TextBox value={note} onChangeText={setNote} multiline maxLength={1000} placeholder={tr('e.g. Called, wants a quote by Friday')} last />
                <Button label={tr('Save note')} kind="ghost" onPress={saveNote} style={{ marginTop: 8 }} />
            </Group>
        </FormPage>
    );
}
