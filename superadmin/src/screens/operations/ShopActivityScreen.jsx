import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ScrollView, ActivityIndicator } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Badge } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox } from '../../components/feedback';
import usePagedList from '../../hooks/usePagedList';
import { listActivity } from '../../api/opsApi';
import { dateTime, titleCase } from '../../utils/format';

const WHO = [
    { value: '', label: 'Everyone' },
    { value: 'owner', label: 'Owner' },
    { value: 'rider', label: 'Riders' },
    { value: 'superadmin', label: 'Platform' },
    { value: 'system', label: 'Automatic' },
];
const TONE = { owner: 'primary', rider: 'success', superadmin: 'warn', system: 'neutral' };

// "PATCH /api/shop/orders/:id/status"  ->  "Orders: status"
const readable = (a = '') => {
    const m = /^(?:[A-Z_]+\s+)?(?:\/api\/(?:admin\/tenants\/[^/]+\/)?(?:shop\/)?)?([^?]*)/.exec(a);
    const path = (m ? m[1] : a).replace(/[a-f0-9]{24}/gi, '').split('/').filter(Boolean);
    return /^[A-Z_]+$/.test(a) ? titleCase(a.toLowerCase()) : titleCase(path.join(' › ') || a);
};

export default function ShopActivityScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [who, setWho] = useState('');
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);

    const list = usePagedList(
        (page) => listActivity(shopId, { page, limit: 30, ...(who ? { actorType: who } : {}), ...(dq ? { q: dq } : {}) }),
        [shopId, who, dq],
    );

    return (
        <Screen title="Activity log" subtitle={name} scroll={false}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Search an action, like orders or riders" />
            </View>
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {WHO.map((w) => <Chip key={w.label} label={w.label} active={who === w.value} onPress={() => setWho(w.value)} />)}
                </ScrollView>
            </View>
            {list.state === 'loading' ? <SkeletonList avatar={false} /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(a, i) => `${a._id || a.at}-${i}`}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="notes" title="No activity found" hint="Changes made by the owner, riders and the platform appear here." />}
                    renderItem={({ item: a }) => (
                        <Card style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1, paddingRight: spacing.md }} numberOfLines={2}>{readable(a.action)}</Text>
                                {a.status && a.status >= 400 ? <Badge label={`Failed ${a.status}`} tone="danger" /> : null}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
                                <Badge label={a.actorLabel || titleCase(a.actorType)} tone={TONE[a.actorType] || 'neutral'} />
                                <Text style={{ color: t.muted, fontSize: font.xs }}>{dateTime(a.at)}</Text>
                            </View>
                        </Card>
                    )}
                />
            )}
        </Screen>
    );
}
