// One inquiry, like a chat: the conversation fills the screen with quick replies and the box under it. Details has what the customer answered, where it stands,
// the private note, and the button to end the conversation (and open it again). While this screen is open the voice for this customer's replies stays quiet.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, ScrollView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Card, Empty, Chips } from '../../components/owners/ui';
import { FormPage, Group, TextBox } from '../../components/owners/menuBits';
import { Answers, Bubbles, ReplyBox, STATUS_LABEL } from '../../components/common/InquiryThread';
import { inquiries as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useOpenInquiry } from '../../store/owners/useOpenInquiry';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { pickImages, uploadImage } from '../../utils/owners/upload';
import { tr } from '../../i18n';

const digits = (p) => String(p || '').replace(/\D/g, '');
const intl = (p) => { const d = digits(p); return d.length === 10 ? `91${d}` : d; };
const STEPS = ['quoted', 'confirmed', 'rejected'];

export default function OwnerInquiryScreen() {
    const { id } = useRoute().params || {};
    const { text, muted, primary, border, surface } = useBrand();
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const [note, setNote] = useState('');
    const [tab, setTab] = useState('chat');

    useFocusEffect(useCallback(() => { useOpenInquiry.getState().set(id); return () => useOpenInquiry.getState().set(null); }, [id]));   // the voice for this inquiry's replies stays quiet while he is here
    const load = useCallback(() => api.get(id).then((r) => { setI(r); setNote((n) => (n === '' ? r.note || '' : n)); setErr(''); })
        .catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this inquiry.')); }), [id]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onNotification((n) => { if (n?.type === 'inquiry_customer_reply' && String(n?.data?.inquiryId) === String(id)) load(); }), [id, load]);

    if (!i) return <FormPage title={tr('Inquiry')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;

    const closed = i.status === 'closed';
    const send = async ({ text: t, images }) => {
        try { setI(await api.reply(id, { text: t, images })); } catch (e) { showToast(apiError(e)); throw e; }
    };
    const setStatus = async (status) => {
        try { setI(await api.update(id, { status })); showToast(tr('Marked {s}', { s: tr(STATUS_LABEL[status]) })); } catch (e) { showToast(apiError(e)); }
    };
    const end = async () => {
        const yes = await ask({ title: tr('End this conversation?'), message: tr('{n} will not be able to write any more. You can open it again.', { n: i.name }), confirmText: tr('End conversation'), destructive: true });
        if (yes) { await setStatus('closed'); setTab('chat'); }
    };
    const saveNote = async () => { try { await api.update(id, { note }); showToast(tr('Note saved')); } catch (e) { showToast(apiError(e)); } };

    return (
        <FormPage fixed title={i.name}
            footer={closed ? (
                <View>
                    <Text style={{ color: muted, textAlign: 'center', marginBottom: 8 }}>{tr('This conversation has ended.')}</Text>
                    <Button label={tr('Open it again')} icon="refresh" kind="ghost" onPress={() => setStatus('replied')} />
                </View>
            ) : <ReplyBox onSend={send} placeholder={tr('Reply to {n}', { n: i.name })} pickMany={(n) => pickImages({ limit: n })} upload={async (p) => (await uploadImage({ kind: 'service', ...p })).url} />}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 15 }}>{i.serviceName}</Text>
                    <Text numberOfLines={1} style={{ color: muted, fontSize: 12 }}>{i.phone} · {tr(STATUS_LABEL[i.status] || 'New')}</Text>
                </View>
                <Pressable onPress={() => Linking.openURL(`tel:${digits(i.phone)}`)} accessibilityLabel={tr('Call')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                    <Ionicons name="call" size={20} color="#fff" />
                </Pressable>
                <Pressable onPress={() => Linking.openURL(`https://wa.me/${intl(i.phone)}`)} accessibilityLabel="WhatsApp" style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                    <Ionicons name="logo-whatsapp" size={22} color={text} />
                </Pressable>
            </View>
            <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
                {[['chat', 'Chat'], ['details', 'Details']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: tab === k ? primary : border }}>
                        <Text style={{ color: tab === k ? primary : muted, fontWeight: '900' }}>{tr(l)}</Text>
                    </Pressable>
                ))}
            </View>
            {tab === 'chat' ? (
                <>
                    <Bubbles messages={i.messages} side="owner" />
                    {!closed && i.quickReplies?.length ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 44 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                            {i.quickReplies.map((q) => (
                                <Pressable key={q} onPress={() => send({ text: q, images: [] }).catch(() => { })} style={{ marginRight: 8, paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                    <Text numberOfLines={1} style={{ color: text, fontSize: 13 }}>{q}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : null}
                </>
            ) : (
                <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                    {i.answers?.length || i.estimate ? <Group title={tr('Their answers')}><Answers answers={i.answers} estimate={i.estimate} /></Group> : null}
                    <Group title={tr('Where it stands')} hint={tr('Now: {s}', { s: tr(STATUS_LABEL[i.status]) })}>
                        <Chips options={STEPS.map((s) => [s, tr(STATUS_LABEL[s])])} value={i.status} onChange={setStatus} />
                    </Group>
                    <Group title={tr('Private note')} hint={tr('Only you can see this.')}>
                        <TextBox value={note} onChangeText={setNote} multiline maxLength={1000} placeholder={tr('e.g. Called, wants a quote by Friday')} last />
                        <Button label={tr('Save note')} kind="ghost" onPress={saveNote} style={{ marginTop: 8 }} />
                    </Group>
                    <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                        {closed ? <Button label={tr('Open it again')} icon="refresh" kind="ghost" onPress={() => setStatus('replied')} /> : <Button label={tr('End conversation')} icon="close-circle-outline" kind="danger" onPress={end} />}
                    </View>
                </ScrollView>
            )}
        </FormPage>
    );
}
