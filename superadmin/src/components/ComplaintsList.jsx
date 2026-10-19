import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../theme';
import { Card, Chip, Badge } from './ui';
import { SkeletonList } from './blocks';
import { Empty, ErrorBox } from './feedback';
import usePagedList from '../hooks/usePagedList';
import { listAllComplaints, listShopComplaints } from '../api/opsApi';
import { ago, titleCase } from '../utils/format';

const CHIPS = [
    { value: '', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
];
export const TYPE_NAME = {
    missing_item: 'Missing item', wrong_item: 'Wrong item', quality: 'Quality', late: 'Late', packaging: 'Packaging', other: 'Other', not_received: 'Not received',
};
const TONE = { open: 'danger', in_progress: 'warn', resolved: 'success' };

// Complaints of one shop (shopId) or of every shop (no shopId).
export default function ComplaintsList({ shopId, shopName }) {
    const t = useTheme();
    const nav = useNavigation();
    const [status, setStatus] = useState('open');
    const first = useRef(true);

    const list = usePagedList(
        (page) => (shopId
            ? listShopComplaints(shopId, { page, ...(status ? { status } : {}) })
            : listAllComplaints({ page, ...(status ? { status } : {}) })),
        [shopId, status],
    );

    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    return (
        <View style={{ flex: 1 }}>
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {CHIPS.map((c) => <Chip key={c.label} label={c.label} active={status === c.value} onPress={() => setStatus(c.value)} />)}
                </ScrollView>
            </View>
            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(c) => String(c.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="message" title={status === 'open' ? 'No open complaints' : 'No complaints here'} hint="Customers raise complaints from a delivered order." />}
                    renderItem={({ item: c }) => (
                        <Card
                            onPress={() => nav.navigate('ComplaintDetail', { shopId: shopId || String(c.tenantId), shopName: shopName || c.shop, complaint: c })}
                            style={{ marginBottom: spacing.sm }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{TYPE_NAME[c.type] || titleCase(c.type)} · #{c.orderNo}</Text>
                                <Badge label={titleCase(c.status)} tone={TONE[c.status] || 'neutral'} />
                            </View>
                            {!shopId && c.shop ? <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }}>{c.shop}</Text> : null}
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }} numberOfLines={2}>{c.text}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 6 }}>{c.customerName || 'Customer'} · {ago(c.createdAt)}{c.photos?.length ? ` · ${c.photos.length} photo${c.photos.length > 1 ? 's' : ''}` : ''}</Text>
                        </Card>
                    )}
                />
            )}
        </View>
    );
}
