import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Badge, Avatar } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox } from '../../components/feedback';
import { fetchUsers } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { ago, titleCase } from '../../utils/format';

const ROLES = [
    { value: '', label: 'All' }, { value: 'customer', label: 'Customers' },
    { value: 'rider', label: 'Riders' }, { value: 'admin', label: 'Owners' }, { value: 'blocked', label: 'Blocked' },
];

export default function ShopUsersScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [q, setQ] = useState('');
    const [role, setRole] = useState('');
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState('loading');   // loading | ready | error
    const [more, setMore] = useState(false);
    const [error, setError] = useState('');
    const seq = useRef(0);

    const load = useCallback(async (p = 1) => {
        const mine = ++seq.current;   // ignore answers of an older search
        if (p === 1) setState('loading'); else setMore(true);
        try {
            const params = { page: p, limit: 20, ...(q.trim() ? { q: q.trim() } : {}) };
            if (role === 'blocked') params.blocked = 'true'; else if (role) params.role = role;
            const r = await fetchUsers(shopId, params);
            if (mine !== seq.current) return;
            setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
            setPage(r.page); setHasMore(r.hasMore); setState('ready');
        } catch (e) {
            if (mine !== seq.current) return;
            if (p === 1) { setError(errMsg(e)); setState('error'); }
        } finally { if (mine === seq.current) setMore(false); }
    }, [shopId, q, role]);

    useEffect(() => { const id = setTimeout(() => load(1), 300); return () => clearTimeout(id); }, [load]);

    return (
        <Screen title="Users" subtitle={name} scroll={false}>
            <View style={{ paddingHorizontal: spacing.lg }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Search name or part of a number" />
            </View>
            <View style={{ height: 52, marginTop: spacing.md }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
                    {ROLES.map((r) => <Chip key={r.value} label={r.label} active={role === r.value} onPress={() => setRole(r.value)} />)}
                </ScrollView>
            </View>

            {state === 'loading' ? <SkeletonList count={4} /> : state === 'error' ? <ErrorBox message={error} onRetry={() => load(1)} /> : (
                <FlatList
                    data={items}
                    keyExtractor={(u) => String(u.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    onEndReached={() => { if (hasMore && !more) load(page + 1); }}
                    onEndReachedThreshold={0.4}
                    ListEmptyComponent={<Empty icon="users" title="No users found" hint="Try another search or filter." />}
                    ListFooterComponent={more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    renderItem={({ item }) => (
                        <Card onPress={() => nav.navigate('ShopUserDetail', { shopId, userId: item.id, shopName: name })} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Avatar section={item.role === 'rider' ? 'riders' : item.role === 'admin' ? 'money' : 'people'} name={item.name || item.phone} />
                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700' }} numberOfLines={1}>{item.name || item.phone}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                                        {item.name ? `${item.phone} · ` : ''}last seen {ago(item.lastLoginAt)}
                                    </Text>
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                                <Badge label={item.role === 'admin' ? 'Owner' : titleCase(item.role)} tone={item.role === 'admin' ? 'primary' : item.role === 'rider' ? 'success' : 'info'} />
                                {item.isBlocked ? <Badge label="Blocked" tone="danger" /> : null}
                            </View>
                        </Card>
                    )}
                />
            )}
        </Screen>
    );
}
