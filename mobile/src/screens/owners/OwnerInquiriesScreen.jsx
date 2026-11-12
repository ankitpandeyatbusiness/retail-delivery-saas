// Inquiries: what customers sent from your service forms. Newest conversation first; a dot means they wrote and you have not opened it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Frame, Hero, GlassStat } from '../../components/owners/RiderDesk';
import Masonry from '../../components/common/Masonry';
import { PageHeader, Card, Pill, Chips, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { STATUS_LABEL } from '../../components/common/InquiryThread';
import { inquiries as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { tr } from '../../i18n';

export default function OwnerInquiriesScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, status tabs with counts, and the inquiries as cards in two columns
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
              <Frame desk={desk}>
                {desk ? (
                    <>
                        <Hero icon="chatbubbles" title={tr('Inquiries')} subtitle={tr('What customers sent from your service forms. A dot means they wrote and you have not opened it.')}>
                            <View style={{ flexDirection: 'row', marginTop: 18 }}>
                                <GlassStat label={tr('All')} value={String(total)} icon="list-outline" />
                                <GlassStat label={tr('Not opened')} value={String(data?.unread || 0)} icon="mail-unread-outline" />
                                <GlassStat label={tr(STATUS_LABEL.new || 'New')} value={String(counts.new || 0)} icon="sparkles-outline" />
                            </View>
                        </Hero>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginBottom: 4 }}>
                            {opts.map(([k, label]) => (
                                <Pressable key={k} onPress={() => setStatus(k)} style={({ hovered }) => ({ paddingHorizontal: 16, height: 38, borderRadius: 19, marginRight: 8, marginBottom: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderColor: status === k ? primary : hovered ? alpha(primary, 0.55) : alpha(muted, 0.3), backgroundColor: status === k ? primary : hovered ? alpha(primary, 0.07) : 'transparent', cursor: 'pointer' })}>
                                    <Text style={{ color: status === k ? '#FFFFFF' : text, fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </>
                ) : null}
                {desk ? null : <View style={{ paddingHorizontal: 16 }}><Chips options={opts} value={status} onChange={setStatus} /></View>}
                {data === null ? <ListShimmer /> : null}
                {err && !data?.items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {data && !data.items.length && !err ? <Empty icon="chatbubbles-outline" title={tr('No inquiries here')} hint={tr('When a customer sends an inquiry from a service, it appears here.')} /> : null}
                <Masonry desk={desk} gap={-16}>
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
                            {last ? <Text numberOfLines={2} style={{ color: text, marginTop: 6 }}>{last.from === 'owner' ? `${tr('You')}: ` : ''}{last.text ? tr(last.text) : tr('Photo')}</Text> : null}
                        </Card>
                    );
                })}
                </Masonry>
              </Frame>
            </ScrollView>
        </View>
    );
}
