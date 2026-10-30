// Account, My inquiries: what I sent to the shop and where it stands. (Replies come with the owner's Inquiries screen.)
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchMyInquiries } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

const STATUS = { new: 'Sent', replied: 'Replied', quoted: 'Quoted', confirmed: 'Confirmed', rejected: 'Not possible', closed: 'Closed' };

export default function MyInquiriesScreen() {
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
                {(items || []).map((i) => (
                    <Card key={i._id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{i.serviceName}</Text>
                            <Pill label={tr(STATUS[i.status] || 'Sent')} color={tone(i.status)} />
                        </View>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{new Date(i.createdAt).toLocaleDateString()}</Text>
                        {i.message ? <Text style={{ color: text, marginTop: 8 }}>{i.message}</Text> : null}
                        {(i.answers || []).map((a) => (
                            <Text key={a.id} style={{ color: muted, fontSize: 13, marginTop: 3 }}>{a.label}: {Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? tr('Yes') : tr('No')) : String(a.value)}</Text>
                        ))}
                    </Card>
                ))}
            </ScrollView>
        </View>
    );
}
