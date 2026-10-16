// Help and support: how to reach the platform team (call, WhatsApp, email), and the owner's requests with their replies.
// Works even when the shop is paused for rent or the panel is blocked.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, Linking } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Pill, Button, Empty } from '../../components/owners/ui';
import { ListShimmer, LineShimmer } from '../../components/owners/shimmer';
import { fetchSupport, fetchSupportInfo, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { callPhone, whatsApp } from '../../components/owners/orderBits';
import { SUPPORT_TOPICS, SUPPORT_STATUS } from '../../utils/owners/supportRules';
import { ago } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';

function ContactCard({ info }) {
    const { text, muted, primary } = useBrand();
    if (!info) return <Card><LineShimmer width="60%" height={16} /><View style={{ height: 8 }} /><LineShimmer width="100%" height={44} /></Card>;
    const any = info.phone || info.whatsapp || info.email;
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="headset" size={24} color={primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>We are here to help</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{[info.hours, info.replyPromise].filter(Boolean).join(' · ') || 'Send us a request and we will reply.'}</Text>
                </View>
            </View>
            {any ? (
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    {info.phone ? <View style={{ flex: 1, marginRight: 6 }}><Button label="Call" icon="call" kind="ghost" onPress={() => callPhone(info.phone.replace(/[^\d+]/g, ''))} /></View> : null}
                    {info.whatsapp ? <View style={{ flex: 1, marginHorizontal: 3 }}><Button label="WhatsApp" icon="logo-whatsapp" kind="ghost" onPress={() => whatsApp(info.whatsapp)} /></View> : null}
                    {info.email ? <View style={{ flex: 1, marginLeft: 6 }}><Button label="Email" icon="mail" kind="ghost" onPress={() => Linking.openURL(`mailto:${info.email}`).catch(() => showToast('No email app found'))} /></View> : null}
                </View>
            ) : null}
        </Card>
    );
}

export default function OwnerSupportScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, error } = useBrand();
    const [info, setInfo] = useState(null);
    const [status, setStatus] = useState('open');
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1, st = status) => {
        try {
            const r = await fetchSupport({ status: st, page: p });
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
            useOwnerStore.setState({ supportUnread: r.unreadCount || 0 });
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your requests.')); setItems((x) => x || []); }
    }, [status]);

    useFocusEffect(useCallback(() => {
        fetchSupportInfo().then(setInfo).catch(() => setInfo({}));
        load(1);
    }, [load]));
    const pick = (st) => { setStatus(st); setItems(null); };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Help and support" />
            <FlatList
                data={items || []}
                keyExtractor={(t) => String(t.id)}
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={(
                    <View>
                        <ContactCard info={info} />
                        <View style={{ paddingHorizontal: 16, marginBottom: 6 }}><Button label="Ask for help" icon="create" onPress={() => nav.navigate('OwnerSupportNew')} /></View>
                        <View style={{ paddingHorizontal: 16 }}><Chips options={[['open', 'Open'], ['resolved', 'Solved']]} value={status} onChange={pick} style={{ marginTop: 6 }} /></View>
                    </View>
                )}
                renderItem={({ item: t }) => {
                    const st = SUPPORT_STATUS[t.status] || SUPPORT_STATUS.open;
                    return (
                        <Card onPress={() => nav.navigate('OwnerSupportTicket', { id: String(t.id) })}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {t.ownerUnread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: error, marginRight: 8 }} /> : null}
                                <Text style={{ flex: 1, color: text, fontWeight: t.ownerUnread ? '900' : '800' }} numberOfLines={1}>#{t.number} · {t.subject}</Text>
                                <Pill label={st.label} color={st.color(primary, error)} />
                            </View>
                            {t.last ? <Text style={{ color: muted, marginTop: 6 }} numberOfLines={2}>{t.last.from === 'platform' ? 'Support: ' : 'You: '}{t.last.text}</Text> : null}
                            <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{SUPPORT_TOPICS.find((x) => x[0] === t.category)?.[1] || 'Other'} · {ago(t.lastMessageAt)}</Text>
                        </Card>
                    );
                }}
                ListEmptyComponent={items === null ? <ListShimmer count={3} /> : err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : <Empty icon="chatbubbles-outline" title={status === 'open' ? 'No open requests' : 'Nothing solved yet'} hint={status === 'open' ? 'Tap "Ask for help" and tell us what you need.' : undefined} />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>Show more</Text></Pressable> : null}
            />
        </View>
    );
}
