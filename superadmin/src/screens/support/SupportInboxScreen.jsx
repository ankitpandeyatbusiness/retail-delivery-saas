import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Chip, Badge } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox } from '../../components/feedback';
import usePagedList from '../../hooks/usePagedList';
import { fetchSupportList } from '../../api/supportApi';
import { ago } from '../../utils/format';

export const TOPIC = { billing: 'Bill or payment', orders: 'Menu or orders', app: 'App problem', account: 'Phone or shop details', other: 'Other' };
export const STATUS = {
    open: { label: 'Needs reply', tone: 'danger' },
    answered: { label: 'Waiting for shop', tone: 'info' },
    resolved: { label: 'Solved', tone: 'success' },
};
const PRIORITY_TONE = { urgent: 'danger', high: 'warn' };

// Help requests from shop owners. The ones that need a reply come first.
export default function SupportInboxScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [status, setStatus] = useState('open');
    const [typed, setTyped] = useState('');
    const [q, setQ] = useState('');
    const [counts, setCounts] = useState(null);
    const first = useRef(true);
    const timer = useRef(null);

    const list = usePagedList(async (page) => {
        const r = await fetchSupportList({ status, page, ...(q ? { q } : {}) });
        setCounts(r.counts);
        return { items: r.items, hasMore: r.hasMore, page: r.page };
    }, [status, q]);

    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));
    useEffect(() => () => clearTimeout(timer.current), []);
    const onType = (v) => { setTyped(v); clearTimeout(timer.current); timer.current = setTimeout(() => setQ(v.trim()), 400); };
    const n = (k) => (counts ? counts[k] || 0 : 0);

    return (
        <Screen title="Support" subtitle="Help requests from shop owners" scroll={false} right={<HeaderButton icon="tune" onPress={() => nav.navigate('SupportSettings')} />}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <SearchBar value={typed} onChangeText={onType} placeholder="Shop name, title or #number" />
            </View>
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    <Chip label={`Needs reply${n('open') ? ` (${n('open')})` : ''}`} active={status === 'open'} onPress={() => setStatus('open')} />
                    <Chip label={`Waiting for shop${n('answered') ? ` (${n('answered')})` : ''}`} active={status === 'answered'} onPress={() => setStatus('answered')} />
                    <Chip label="Solved" active={status === 'resolved'} onPress={() => setStatus('resolved')} />
                    <Chip label="All" active={status === 'all'} onPress={() => setStatus('all')} />
                </ScrollView>
            </View>
            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(x) => String(x.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="message" title={status === 'open' ? 'Nothing waiting' : 'No requests here'} hint="Help requests from shop owners appear here." />}
                    renderItem={({ item: x }) => {
                        const st = STATUS[x.status] || STATUS.open;
                        return (
                            <Pressable
                                onPress={() => nav.navigate('SupportDetail', { id: String(x.id) })}
                                style={({ pressed }) => [{ padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.lg, backgroundColor: x.platformUnread ? t.primarySoft : t.surface, opacity: pressed ? 0.9 : 1 }, x.platformUnread && { borderLeftWidth: 4, borderLeftColor: t.primary }]}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ flex: 1, color: t.text, fontWeight: x.platformUnread ? '800' : '700', fontSize: font.md }} numberOfLines={1}>{x.shop}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.xs }}>{ago(x.lastMessageAt)}</Text>
                                </View>
                                <Text style={{ color: t.text, marginTop: 3 }} numberOfLines={1}>#{x.number} · {x.subject}</Text>
                                {x.last ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 3 }} numberOfLines={2}>{x.last.from === 'platform' ? 'You: ' : 'Owner: '}{x.last.text}</Text> : null}
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8, flexWrap: 'wrap' }}>
                                    <Badge label={st.label} tone={st.tone} />
                                    <Badge label={TOPIC[x.category] || 'Other'} tone="neutral" />
                                    {PRIORITY_TONE[x.priority] ? <Badge label={x.priority === 'urgent' ? 'Urgent' : 'High'} tone={PRIORITY_TONE[x.priority]} icon="warning" /> : null}
                                    {x.rating ? <Badge label={`${x.rating} of 5`} tone="success" icon="star" /> : null}
                                </View>
                            </Pressable>
                        );
                    }}
                />
            )}
        </Screen>
    );
}
