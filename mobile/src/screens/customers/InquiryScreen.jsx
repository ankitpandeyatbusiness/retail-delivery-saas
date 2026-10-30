// One inquiry I sent: what I asked, the shop's replies, and a box to write again.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Empty, Pill } from '../../components/owners/ui';
import { FormPage, Group } from '../../components/owners/menuBits';
import { Answers, Bubbles, ReplyBox, STATUS_LABEL } from '../../components/common/InquiryThread';
import { fetchInquiry, sendInquiryMessage } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function InquiryScreen() {
    const { id } = useRoute().params || {};
    const { text, muted } = useBrand();
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => fetchInquiry(id).then(setI).catch((e) => setErr(e?.response?.data?.error || tr('Could not open this inquiry'))), [id]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onNotification((n) => { if (n?.type === 'inquiry_reply' && String(n?.data?.inquiryId) === String(id)) load(); }), [id, load]);

    if (!i) return <FormPage title={tr('Inquiry')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;

    const send = async (t) => {
        try { await sendInquiryMessage(id, t); await load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); throw e; }
    };
    const closed = i.status === 'closed';

    return (
        <FormPage title={i.serviceName} footer={closed ? <Text style={{ color: muted, textAlign: 'center' }}>{tr('This inquiry is closed.')}</Text> : <ReplyBox onSend={send} />}>
            <Card style={{ marginHorizontal: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 17, flex: 1 }}>{i.serviceName}</Text>
                    <Pill label={tr(STATUS_LABEL[i.status] || 'New')} color={muted} />
                </View>
                <Text style={{ color: muted, marginTop: 2 }}>{new Date(i.createdAt).toLocaleDateString()}</Text>
            </Card>
            {i.answers?.length || i.estimate ? <Group title={tr('What I asked')}><Answers answers={i.answers} estimate={i.estimate} /></Group> : null}
            <Group title={tr('Conversation')}><Bubbles messages={i.messages} side="customer" /></Group>
        </FormPage>
    );
}
