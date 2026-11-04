import React, { useEffect, useMemo, useState } from 'react';
import { View, FlatList, Text, Pressable } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { SearchBar } from '../../components/inputs';
import { Card, Badge, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { FadeInRow } from '../../components/motion';
import { Empty, ErrorBox, Sheet, SheetScroll, toast } from '../../components/feedback';
import { FunnelButton, FilterPopup } from '../../components/FilterPopup';
import Icon from '../../components/Icon';
import usePagedList from '../../hooks/usePagedList';
import { useSupreme } from '../../hooks/useSupreme';
import { useShopsStore } from '../../store/useShopsStore';
import { listCustomers, shareCustomerListExcel } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, ago } from '../../utils/format';

const SORTS = [['spent', 'Spent most'], ['orders', 'Most orders'], ['last', 'Ordered lately'], ['cancels', 'Cancels most'], ['joined', 'Joined lately']];

// Customers of every shop (or one shop). Phones are masked; the supreme admin can switch to full numbers (written to the audit log).
export default function CustomersScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const fixed = useRoute().params || {};   // { shopId, name } when opened from one shop
    const supreme = useSupreme();
    const shops = useShopsStore((s) => s.items);
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [sort, setSort] = useState('spent');
    const [shopId, setShopId] = useState(fixed.shopId || '');
    const [full, setFull] = useState(false);
    const [filters, setFilters] = useState(false);
    const [picker, setPicker] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);
    useEffect(() => { if (!fixed.shopId && !shops.length) useShopsStore.getState().load(); }, [fixed.shopId, shops.length]);

    const params = useMemo(() => ({ sort, ...(shopId ? { tenantId: shopId } : {}), ...(dq ? { q: dq } : {}), ...(full ? { full: 1 } : {}) }), [sort, shopId, dq, full]);
    const list = usePagedList((page) => listCustomers({ ...params, page, limit: 30 }), [params]);

    const shopName = fixed.name || shops.find((s) => s._id === shopId)?.name;
    const activeCount = (sort !== 'spent' ? 1 : 0) + (!fixed.shopId && shopId ? 1 : 0) + (full ? 1 : 0);
    const summary = [SORTS.find((x) => x[0] === sort)?.[1], !fixed.shopId && shopId ? shopName : null, full ? 'Full phones' : null].filter(Boolean).join(' · ');
    const clearFilters = () => { setSort('spent'); if (!fixed.shopId) setShopId(''); setFull(false); };
    const sections = [
        { key: 'sort', title: 'Sort by', options: SORTS, value: sort, onChange: setSort },
        ...(!fixed.shopId ? [{ key: 'shop', title: 'Shop', row: shopId ? (shopName || 'One shop') : 'All shops', active: !!shopId, onPress: () => { setFilters(false); setTimeout(() => setPicker(true), 250); } }] : []),
        ...(supreme ? [{ key: 'phones', title: 'Phone numbers', options: [[false, 'Hidden (98XXXXXX21)'], [true, 'Full numbers']], value: full, onChange: setFull }] : []),
    ];

    const download = async () => {
        setBusy(true);
        try { await shareCustomerListExcel(params); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not prepare the file'), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Customers" subtitle={fixed.name || 'Every shop'} scroll={false}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, marginRight: spacing.md }}>
                    <SearchBar value={q} onChangeText={setQ} placeholder="Name or part of a phone number" />
                </View>
                <FunnelButton count={activeCount} onPress={() => setFilters(true)} />
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: activeCount ? t.primary : t.muted, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>
                    {list.total != null ? `${list.total} customer${list.total === 1 ? '' : 's'} · ` : ''}{summary}
                </Text>
                <Button title="Excel" icon="receipt" kind="soft" loading={busy} onPress={download} />
            </View>

            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(c) => c.userId}
                    contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="users" title="No customers found" hint="Try another name, phone or shop." />}
                    renderItem={({ item: c, index }) => (
                        <FadeInRow index={index}>
                            <Card onPress={() => nav.navigate('ShopUserDetail', { shopId: c.tenantId, userId: c.userId, shopName: c.shopName })} style={{ marginBottom: spacing.md }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{c.name || 'Customer'}</Text>
                                    {c.blocked ? <Badge label="Blocked" tone="danger" /> : null}
                                </View>
                                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{c.phone}</Text>
                                <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{c.shopName}</Text>
                                <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                                    {[['Spent', rupees(c.spent)], ['Orders', c.orders], ['Cancelled', c.cancelled], ['Not home', c.noShow]].map(([l, v]) => (
                                        <View key={l} style={{ flex: 1 }}>
                                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>{v}</Text>
                                            <Text style={{ color: t.muted, fontSize: 10 }}>{l}</Text>
                                        </View>
                                    ))}
                                </View>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>{c.lastAt ? `Last order ${ago(c.lastAt)}` : 'Never ordered'}</Text>
                            </Card>
                        </FadeInRow>
                    )}
                />
            )}

            <FilterPopup visible={filters} onClose={() => setFilters(false)} title="Filter customers" sections={sections} activeCount={activeCount} onClear={clearFilters} />
            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shop?">
                <SheetScroll style={{ maxHeight: 380 }}>
                    <Pressable onPress={() => { setShopId(''); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }}>All shops</Text>
                        {!shopId ? <Icon name="ok" size={20} color={t.primary} /> : null}
                    </Pressable>
                    {shops.map((s) => (
                        <Pressable key={s._id} onPress={() => { setShopId(s._id); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{s.name}</Text>
                            {shopId === s._id ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
            </Sheet>
        </Screen>
    );
}
