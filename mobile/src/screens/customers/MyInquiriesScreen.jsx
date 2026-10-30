// Account, My inquiries: what I sent to the shop and where it stands. Tap one to read the replies and write back.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { STATUS_LABEL } from '../../components/common/InquiryThread';
import { fetchMyInquiries } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

export default function MyInquiriesScreen() {
    const nav = useNavigation();
    const { background, text, muted, ok, error } = useBrand();
    const [items, setItems] = useState(null);
    const load = useCallback(() => { fetchMyInquiries().then((r) => setItems(r.items || [])).catch(() => setItems((x) => x || [])); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const tone = (st) => (st === 'confirmed' ? ok : st === 'rejected' ? error : muted);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My inquiries')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {items && !items.length ? <Empty icon="chatbubbles-outline" title={tr('No inquiries yet')} hint={tr('Open Services and send one.')} /> : null}
                {(items || []).map((i) => {
                    const last = i.messages?.[i.messages.length - 1];
                    return (
                        <Card key={i._id} onPress={() => nav.navigate('Inquiry', { id: String(i._id) })}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {i.customerUnread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: error, marginRight: 8 }} /> : null}
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{i.serviceName}</Text>
                                <Pill label={tr(STATUS_LABEL[i.status] || 'New')} color={tone(i.status)} />
                            </View>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{new Date(i.createdAt).toLocaleDateString()}</Text>
                            {last ? <Text numberOfLines={2} style={{ color: text, marginTop: 6 }}>{last.from === 'owner' ? `${tr('Shop')}: ` : ''}{last.text}</Text> : null}
                        </Card>
                    );
                })}
            </ScrollView>
        </View>
    );
}
