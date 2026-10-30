// Inquiries: what customers sent from your service forms. Newest conversation first; a dot means they wrote and you have not opened it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Chips, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { STATUS_LABEL } from '../../components/common/InquiryThread';
import { inquiries as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { tr } from '../../i18n';

export default function OwnerInquiriesScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, ok, error } = useBrand();
    const [status, setStatus] = useState('all');
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        try { setData(await api.list({ status })); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your inquiries.')); setData((x) => x || { items: [], counts: {}, unread: 0 }); }
    }, [status]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => onNotification((n) => { if (['inquiry_new', 'inquiry_customer_reply'].includes(String(n?.type))) load(); }), [load]);   // a new one shows at once

    const counts = data?.counts || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const opts = [['all', `${tr('All')} ${total}`], ...Object.keys(STATUS_LABEL).map((k) => [k, `${tr(STATUS_LABEL[k])} ${counts[k] || 0}`])];
    const tone = (st) => (st === 'confirmed' ? ok : st === 'rejected' ? error : st === 'new' ? primary : muted);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Inquiries')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                <View style={{ paddingHorizontal: 16 }}><Chips options={opts} value={status} onChange={setStatus} /></View>
                {data === null ? <ListShimmer /> : null}
                {err && !data?.items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {data && !data.items.length && !err ? <Empty icon="chatbubbles-outline" title={tr('No inquiries here')} hint={tr('When a customer sends an inquiry from a service, it appears here.')} /> : null}
                {(data?.items || []).map((i) => {
                    const last = i.messages?.[i.messages.length - 1];
                    return (
                        <Card key={i._id} onPress={() => nav.navigate('OwnerInquiry', { id: String(i._id) })}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {i.ownerUnread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: error, marginRight: 8 }} /> : null}
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{i.name}</Text>
                                <Pill label={tr(STATUS_LABEL[i.status] || 'New')} color={tone(i.status)} />
                            </View>
                            <Text numberOfLines={1} style={{ color: muted, fontSize: 12, marginTop: 2 }}>{i.serviceName} · {new Date(i.lastMessageAt || i.createdAt).toLocaleDateString()}</Text>
                            {last ? <Text numberOfLines={2} style={{ color: text, marginTop: 6 }}>{last.from === 'owner' ? `${tr('You')}: ` : ''}{last.text}</Text> : null}
                        </Card>
                    );
                })}
            </ScrollView>
        </View>
    );
}
