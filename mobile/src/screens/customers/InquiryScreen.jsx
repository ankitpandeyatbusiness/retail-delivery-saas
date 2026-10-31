// One inquiry I sent, like a chat: the conversation fills the screen with the box under it; the Details tab has what I asked and where it stands.
// It follows the shop live: a reply, a change of status or the end of the conversation show at once.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Empty, Pill } from '../../components/owners/ui';
import { FormPage, Group } from '../../components/owners/menuBits';
import { Answers, Bubbles, ReplyBox, STATUS_LABEL } from '../../components/common/InquiryThread';
import { fetchInquiry, sendInquiryMessage } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { pickImages } from '../../utils/owners/upload';
import { uploadInquiryPhoto } from '../../utils/common/photoUpload';
import { tr } from '../../i18n';

export default function InquiryScreen() {
    const { id } = useRoute().params || {};
    const { text, muted, primary, onPrimary, border, surface } = useBrand();
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const [tab, setTab] = useState('chat');
    const load = useCallback(() => fetchInquiry(id).then(setI).catch((e) => setErr(e?.response?.data?.error || tr('Could not open this inquiry'))), [id]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onNotification((n) => { if (String(n?.type || '').startsWith('inquiry_') && String(n?.data?.inquiryId) === String(id)) load(); }), [id, load]);

    if (!i) return <FormPage title={tr('Inquiry')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;

    const send = async ({ text: t, images }) => {
        try { await sendInquiryMessage(id, { text: t, images }); await load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); throw e; }
    };
    const closed = i.status === 'closed';

    return (
        <FormPage fixed title={i.serviceName}
            footer={closed ? <Text style={{ color: muted, textAlign: 'center' }}>{tr('The shop ended this conversation.')}</Text>
                : <ReplyBox onSend={send} pickMany={(n) => pickImages({ limit: n })} upload={async (p) => (await uploadInquiryPhoto(p)).url} />}>
            <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
                {[['chat', 'Chat'], ['details', 'Details']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: tab === k ? primary : border }}>
                        <Text style={{ color: tab === k ? primary : muted, fontWeight: '900' }}>{tr(l)}</Text>
                    </Pressable>
                ))}
            </View>
            {tab === 'chat' ? <Bubbles messages={i.messages} side="customer" /> : (
                <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 17, flex: 1 }}>{i.serviceName}</Text>
                            <Pill label={tr(STATUS_LABEL[i.status] || 'New')} color={muted} />
                        </View>
                        <Text style={{ color: muted, marginTop: 2 }}>{new Date(i.createdAt).toLocaleDateString()}</Text>
                    </Card>
                    {i.answers?.length || i.estimate ? <Group title={tr('What I asked')}><Answers answers={i.answers} estimate={i.estimate} /></Group> : null}
                </ScrollView>
            )}
        </FormPage>
    );
}
