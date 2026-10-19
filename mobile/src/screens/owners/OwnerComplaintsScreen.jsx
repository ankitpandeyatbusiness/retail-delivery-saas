// Complaints from customers: New / In progress / Decided. Tap one to read it and answer.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Pill, Empty } from '../../components/owners/ui';
import { fetchComplaints, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { COMPLAINT_TYPES, COMPLAINT_STATUS, RESOLUTION_TEXT } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';
import GlowBorder from '../../components/common/GlowBorder';
import { tr } from '../../i18n';

export default function OwnerComplaintsScreen() {
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary } = useBrand();
    const [status, setStatus] = useState('open');
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1, st = status) => {
        try {
            const r = await fetchComplaints({ status: st, page: p });
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load complaints.')); setItems((x) => x || []); }
    }, [status]);

    useFocusEffect(useCallback(() => { load(1); }, [load]));
    const pick = (s) => { setStatus(s); setItems(null); };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Complaints')} />
            <FlatList
                data={items || []}
                keyExtractor={(c) => String(c.id)}
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={<View style={{ paddingHorizontal: 16, paddingBottom: 16 }}><Chips options={Object.entries(COMPLAINT_STATUS)} value={status} onChange={pick} style={{ marginTop: 0 }} /></View>}
                renderItem={({ item: c }) => (
                    <GlowBorder active={c.status !== 'resolved'} radius={18} style={{ marginHorizontal: 16, marginBottom: 12 }}>
                    <Card onPress={() => nav.navigate('OwnerComplaint', { complaint: c })} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', flex: 1 }} numberOfLines={1}>{tr('Order #{orderNo} · {v2}', { orderNo: c.orderNo, v2: COMPLAINT_TYPES[c.type] || c.type })}</Text>
                            {c.status === 'resolved' ? <Pill label={RESOLUTION_TEXT[c.resolution] || tr('Decided')} color={ok} /> : c.status === 'in_progress' ? <Pill label={tr('In progress')} color={primary} /> : <Pill label={tr('New')} color={error} />}
                        </View>
                        <Text style={{ color: text, marginTop: 6 }} numberOfLines={2}>{c.text}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{c.customerName || tr('Customer')} · {ago(c.createdAt)}{c.photos?.length ? tr(' · {length} photo{v2}', { length: c.photos.length, v2: c.photos.length > 1 ? 's' : '' }) : ''}</Text>
                    </Card>
                    </GlowBorder>
                )}
                ListEmptyComponent={items === null ? <ListShimmer /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="happy-outline" title={status === 'open' ? tr('No new complaints') : tr('Nothing here')} hint={status === 'open' ? tr('Nice. Customers are happy.') : undefined} />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Show more')}</Text></Pressable> : null}
            />
        </View>
    );
}
