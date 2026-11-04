import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Chip, Badge, ListRow } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { ShopRow } from '../../components/shopBits';
import { SkeletonList } from '../../components/blocks';
import { FadeInRow, animateNext } from '../../components/motion';
import { Empty, ErrorBox, Sheet } from '../../components/feedback';
import Icon from '../../components/Icon';
import { useShopsStore, FILTERS, SORTS, matchesFilter, sortShops } from '../../store/useShopsStore';
import { rupees } from '../../utils/format';

// A brand: one row with its branches' totals; tap to see the branches
function BrandRow({ g, open, onToggle, onShop }) {
    const t = useTheme();
    return (
        <View style={{ marginBottom: spacing.sm }}>
            <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [{ backgroundColor: t.surface, borderRadius: radius.lg, padding: spacing.md, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, t.shadow]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', flex: 1 }} numberOfLines={1}>{g.name}</Text>
                    <Badge label={`${g.shops.length} branch${g.shops.length === 1 ? '' : 'es'}`} tone="primary" icon="shops" />
                    <Icon name="next" size={18} color={t.muted} style={{ marginLeft: spacing.sm, transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                    <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700', marginRight: spacing.md }}>{g.ordersToday} orders today</Text>
                    {g.owed > 0 ? <Text style={{ color: g.overdue > 0 ? t.danger : t.muted, fontSize: font.sm, fontWeight: '800' }}>Rent due {rupees(g.owed)}</Text> : <Text style={{ color: t.muted, fontSize: font.sm }}>all rent paid</Text>}
                </View>
            </Pressable>
            {open ? <View style={{ marginTop: spacing.sm, paddingLeft: spacing.md }}>{g.shops.map((s) => <ShopRow key={s._id} shop={s} compact onPress={() => onShop(s)} />)}</View> : null}
        </View>
    );
}

export default function ShopsListScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const route = useRoute();
    const { items, loading, refreshing, error, loaded, load } = useShopsStore();
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all');
    const [sort, setSort] = useState('attention');
    const [group, setGroup] = useState(true);
    const [sortOpen, setSortOpen] = useState(false);
    const [openBrands, setOpenBrands] = useState({});
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

    const shown = useMemo(() => sortShops(items.filter((s) => matchesFilter(s, filter)), sort), [items, filter, sort]);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, items.filter((s) => matchesFilter(s, f.value)).length])), [items]);
    const filtered = q || filter !== 'all';
    const sortName = SORTS.find((x) => x.value === sort)?.label;
    const openShop = (s) => nav.navigate('ShopDetail', { shopId: s._id, name: s.name });

    // brands together (a search shows a plain list, so every match is visible at once)
    const rows = useMemo(() => {
        if (!group || q) return shown.map((s) => ({ key: s._id, shop: s }));
        const brands = new Map(); const out = [];
        for (const s of shown) {
            if (!s.brandId) { out.push({ key: s._id, shop: s }); continue; }
            const id = String(s.brandId);
            if (!brands.has(id)) { const g = { key: 'b' + id, id, name: s.stats?.brandName || 'Brand', shops: [], ordersToday: 0, owed: 0, overdue: 0 }; brands.set(id, g); out.push({ key: g.key, brand: g }); }
            const g = brands.get(id); g.shops.push(s); g.ordersToday += s.stats?.ordersToday || 0; g.owed += s.stats?.owed || 0; g.overdue += s.stats?.overdue || 0;
        }
        return out;
    }, [shown, group, q]);

    return (
        <Screen
            tabScreen
            title="Shops"
            subtitle={loaded ? `${items.length} shop${items.length === 1 ? '' : 's'} · ${sortName}` : undefined}
            scroll={false}
            right={<View style={{ flexDirection: 'row', alignItems: 'center' }}><HeaderButton icon="funnel" onPress={() => setSortOpen(true)} /><View style={{ width: spacing.md }} /><HeaderButton icon="add" onPress={() => nav.navigate('ShopCreate')} /></View>}
        >
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Shop name or code" />
            </View>
            <View style={{ height: 56, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {FILTERS.map((f) => (
                        <Chip key={f.value} label={loaded ? `${f.label}  ${counts[f.value]}` : f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
                    ))}
                    <Chip label="Group brands" icon="shops" active={group} onPress={() => { animateNext(); setGroup((v) => !v); }} />
                </ScrollView>
            </View>

            {loading && !loaded ? <SkeletonList /> : error && !items.length ? (
                <ErrorBox message={error} onRetry={() => load({ q })} />
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(r) => r.key}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={refreshing}
                    onRefresh={() => load({ q, refresh: true })}
                    renderItem={({ item, index }) => (item.brand
                        ? <BrandRow g={item.brand} open={!!openBrands[item.brand.id]} onToggle={() => { animateNext(); setOpenBrands((o) => ({ ...o, [item.brand.id]: !o[item.brand.id] })); }} onShop={openShop} />
                        : <FadeInRow index={index}><ShopRow shop={item.shop} onPress={() => openShop(item.shop)} /></FadeInRow>)}
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

            <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort the shops">
                {SORTS.map((x, i) => (
                    <ListRow key={x.value} section={x.section} icon={x.icon} title={x.label} subtitle={x.hint} right={sort === x.value ? <Icon name="ok" size={22} color={t.primary} /> : null} onPress={() => { setSort(x.value); setSortOpen(false); }} last={i === SORTS.length - 1} />
                ))}
            </Sheet>
        </Screen>
    );
}
