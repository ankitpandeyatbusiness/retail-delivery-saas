// One inquiry I sent, like a chat: the conversation fills the screen with the box under it; the Details tab has what I asked and where it stands.
// It follows the shop live: a reply, a change of status or the end of the conversation show at once.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Empty, Pill } from '../../components/owners/ui';
import { FormPage, Group } from '../../components/owners/menuBits';
import { Answers, STATUS_LABEL } from '../../components/common/InquiryThread';
import ChatButton from '../../components/common/ChatButton';
import { fetchInquiry } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function InquiryScreen() {
    const { id } = useRoute().params || {};
    const { text, muted, primary, onPrimary, border, surface } = useBrand();
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => fetchInquiry(id).then(setI).catch((e) => setErr(e?.response?.data?.error || tr('Could not open this inquiry'))), [id]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onNotification((n) => { if (String(n?.type || '').startsWith('inquiry_') && String(n?.data?.inquiryId) === String(id)) load(); }), [id, load]);

    if (!i) return <FormPage title={tr('Inquiry')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;


    return (
        <FormPage fixed title={tr(i.serviceName)}>
            <View style={{ paddingHorizontal: 16, marginTop: 8, marginBottom: 12 }}><ChatButton kind="inquiry" refId={id} title={tr(i.serviceName)} label={tr('Chat with the shop')} /></View>
            {(
                <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 17, flex: 1 }}>{tr(i.serviceName)}</Text>
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
