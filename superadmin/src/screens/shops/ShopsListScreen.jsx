import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Chip } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { ShopRow } from '../../components/shopBits';
import { SkeletonList } from '../../components/blocks';
import { FadeInRow } from '../../components/motion';
import { Empty, ErrorBox } from '../../components/feedback';
import { useShopsStore, FILTERS, matchesFilter } from '../../store/useShopsStore';

export default function ShopsListScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const { items, loading, refreshing, error, loaded, load } = useShopsStore();
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all');
    const first = useRef(true);

    // the dashboard opens this list already filtered
    useEffect(() => { if (route.params?.filter) setFilter(route.params.filter); }, [route.params?.filter]);

    useEffect(() => {
        // first time: load at once. After that: wait for the typing to pause
        const wait = first.current ? 0 : 350;
        first.current = false;
        const id = setTimeout(() => load({ q }), wait);
        return () => clearTimeout(id);
    }, [q, load]);

    const shown = useMemo(() => items.filter((s) => matchesFilter(s, filter)), [items, filter]);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, items.filter((s) => matchesFilter(s, f.value)).length])), [items]);
    const filtered = q || filter !== 'all';

    return (
        <Screen
            tabScreen
            title="Shops"
            subtitle={loaded ? `${items.length} shop${items.length === 1 ? '' : 's'}` : undefined}
            scroll={false}
            right={<HeaderButton icon="add" onPress={() => nav.navigate('ShopCreate')} />}
        >
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Search by shop name or code" />
            </View>
            <View style={{ height: 56, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {FILTERS.map((f) => (
                        <Chip key={f.value} label={loaded ? `${f.label}  ${counts[f.value]}` : f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
                    ))}
                </ScrollView>
            </View>

            {loading && !loaded ? <SkeletonList /> : error && !items.length ? (
                <ErrorBox message={error} onRetry={() => load({ q })} />
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={(s) => s._id}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={refreshing}
                    onRefresh={() => load({ q, refresh: true })}
                    renderItem={({ item, index }) => <FadeInRow index={index}><ShopRow shop={item} onPress={() => nav.navigate('ShopDetail', { shopId: item._id, name: item.name })} /></FadeInRow>}
                    ListEmptyComponent={
                        <Empty
                            icon="shops"
                            title={filtered ? 'No shops match' : 'No shops yet'}
                            hint={filtered ? 'Try another search or filter.' : 'Add your first shop to get started.'}
                            action={filtered ? undefined : 'Add a shop'}
                            onAction={() => nav.navigate('ShopCreate')}
                        />
                    }
                />
            )}
        </Screen>
    );
}
