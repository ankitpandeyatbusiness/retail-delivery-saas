import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Image, Switch } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Chip, Badge, Button } from '../../components/ui';
import { SearchBar, Segmented } from '../../components/inputs';
import { Loading, Empty, ErrorBox, Sheet, toast } from '../../components/feedback';
import { VegMark } from '../../components/catalogBits';
import Icon from '../../components/Icon';
import { listRecords, updateRecord, fetchAvailability } from '../../api/catalogApi';
import { errMsg } from '../../api/adminClient';
import usePagedList from '../../hooks/usePagedList';
import { rupees } from '../../utils/format';
import { nameOf } from '../../utils/settings';

const DAYS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const timingText = (timings) => {
    if (!timings?.length) return 'Always shown';
    return timings.map((s) => `${s.open}–${s.close}${s.days?.length ? ` (${s.days.map((d) => DAYS[d]).join(', ')})` : ''}`).join(' · ');
};

function Thumb({ uri, size = 56 }) {
    const t = useTheme();
    return uri
        ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
        : <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon name="food" size={size * 0.45} color={t.muted} /></View>;
}

// The shop's menu: items and categories, quick on/off, and why the app hides something.
export default function ShopMenuScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [tab, setTab] = useState('items');
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [cat, setCat] = useState('');
    const [cats, setCats] = useState([]);
    const [hidden, setHidden] = useState([]);
    const [showHidden, setShowHidden] = useState(false);
    const first = useRef(true);

    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(id); }, [q]);

    const loadCats = useCallback(async () => {
        try { setCats((await listRecords(shopId, 'categories', { limit: 100 })).items); } catch (e) { /* the list shows its own error */ }
    }, [shopId]);
    const loadHidden = useCallback(async () => {
        try { setHidden((await fetchAvailability(shopId)).hidden || []); } catch (e) { setHidden([]); }
    }, [shopId]);

    const products = usePagedList(
        (page) => listRecords(shopId, 'products', { page, limit: 30, ...(dq ? { q: dq } : {}), ...(cat ? { categoryId: cat } : {}) }),
        [shopId, dq, cat],
    );

    useFocusEffect(useCallback(() => {
        loadCats();
        loadHidden();
        if (first.current) { first.current = false; return; }
        products.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadCats, loadHidden]));

    const catName = (id) => cats.find((c) => c._id === id)?.name;
    // The switch changes at once (the list is updated before the server answers), so it slides one way and stays.
    // If the save fails it is put back and the reason is shown. A second tap on the same row waits for the first.
    const saving = useRef(new Set());
    const toggle = async (resource, item, field, value, setList) => {
        if (saving.current.has(item._id)) return;
        saving.current.add(item._id);
        const before = item[field] === undefined ? true : item[field];
        const put = (v) => setList((cur) => cur.map((x) => (x._id === item._id ? { ...x, [field]: v } : x)));
        put(value);
        try {
            await updateRecord(shopId, resource, item._id, { [field]: value });
            loadHidden();
        } catch (e) {
            put(before);
            toast(errMsg(e), 'error');
        } finally { saving.current.delete(item._id); }
    };

    // "3 left", "2.5 kg left": pieces, or kg / litres for items sold by weight / volume
    const leftText = (p) => {
        const q = p.stock?.qty || 0;
        if (p.sellBy === 'weight') return `${Math.round(q) / 1000} kg left`;
        if (p.sellBy === 'volume') return `${Math.round(q) / 1000} L left`;
        return `${q} left`;
    };

    const addProduct = () => nav.navigate('ProductForm', { shopId, name });
    const addCategory = () => nav.navigate('CategoryForm', { shopId, name });

    const header = (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'items', label: `Items${products.total != null ? ` (${products.total})` : ''}` }, { value: 'categories', label: `Categories (${cats.length})` }]} />
            {hidden.length ? (
                <Card onPress={() => setShowHidden(true)} style={{ marginTop: spacing.md, backgroundColor: t.warnSoft, shadowOpacity: 0, elevation: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="warning" size={22} color={t.warn} />
                        <Text style={{ color: t.warn, fontWeight: '800', marginLeft: spacing.md, flex: 1 }}>
                            {hidden.length} thing{hidden.length > 1 ? 's are' : ' is'} hidden in the app. Tap to see why.
                        </Text>
                    </View>
                </Card>
            ) : null}
        </View>
    );

    return (
        <Screen
            title="Menu"
            subtitle={name}
            scroll={false}
            right={
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <HeaderButton icon="box" onPress={() => nav.navigate('ProductImport', { shopId, name })} />
                    <HeaderButton icon="add" onPress={tab === 'items' ? addProduct : addCategory} />
                </View>
            }
        >
            {tab === 'items' ? (
                <>
                    {header}
                    <View style={{ paddingHorizontal: spacing.lg }}>
                        <SearchBar value={q} onChangeText={setQ} placeholder="Search items" />
                    </View>
                    <View style={{ height: 52, marginTop: spacing.sm }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
                            <Chip label="All" active={!cat} onPress={() => setCat('')} />
                            {cats.map((c) => <Chip key={c._id} label={c.name} active={cat === c._id} onPress={() => setCat(c._id)} />)}
                        </ScrollView>
                    </View>
                    {products.state === 'loading' ? <Loading /> : products.state === 'error' ? <ErrorBox message={products.error} onRetry={products.reload} /> : (
                        <FlatList
                            data={products.items}
                            keyExtractor={(p) => String(p._id)}
                            contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                            refreshing={products.refreshing}
                            onRefresh={products.refresh}
                            onEndReached={products.loadMore}
                            onEndReachedThreshold={0.4}
                            ListFooterComponent={products.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                            ListEmptyComponent={
                                <Empty
                                    icon="food"
                                    title={dq || cat ? 'No items match' : 'No items yet'}
                                    hint={dq || cat ? 'Try another search or category.' : 'Add items one by one, or import many at once from a CSV file.'}
                                    action={dq || cat ? undefined : 'Add an item'}
                                    onAction={addProduct}
                                />
                            }
                            renderItem={({ item: p }) => (
                                <Card onPress={() => nav.navigate('ProductForm', { shopId, name, id: p._id })} style={{ marginBottom: spacing.sm, opacity: p.isActive === false ? 0.55 : 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Thumb uri={p.image} />
                                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <VegMark isVeg={p.isVeg} />
                                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, marginLeft: 6, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                                            </View>
                                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
                                                {rupees(p.price)}{p.mrp > p.price ? `  ·  MRP ${rupees(p.mrp)}` : ''}{catName(p.categoryId) ? `  ·  ${catName(p.categoryId)}` : ''}
                                            </Text>
                                            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                                {p.isActive === false ? <Badge label="Switched off" tone="danger" /> : null}
                                                {p.isActive !== false && p.isAvailable === false ? <Badge label="Out of stock" tone="warn" /> : null}
                                                {p.stock?.enabled ? <Badge label={leftText(p)} tone="info" /> : null}
                                                {p.isBestseller ? <Badge label="Bestseller" tone="success" /> : null}
                                            </View>
                                        </View>
                                        {p.isActive !== false ? (
                                            <Switch
                                                value={p.isAvailable !== false}
                                                onValueChange={(v) => toggle('products', p, 'isAvailable', v, products.setItems)}
                                                trackColor={{ true: t.success, false: t.border }}
                                            />
                                        ) : null}
                                    </View>
                                </Card>
                            )}
                        />
                    )}
                </>
            ) : (
                <>
                    {header}
                    <FlatList
                        data={cats}
                        keyExtractor={(c) => String(c._id)}
                        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                        ListEmptyComponent={<Empty icon="menu" title="No categories yet" hint="Items are grouped in categories like Starters or Sweets." action="Add a category" onAction={addCategory} />}
                        renderItem={({ item: c }) => (
                            <Card onPress={() => nav.navigate('CategoryForm', { shopId, name, id: c._id })} style={{ marginBottom: spacing.sm, opacity: c.isActive === false ? 0.55 : 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Thumb uri={c.image} size={52} />
                                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{c.name}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }} numberOfLines={1}>{timingText(c.timings)}</Text>
                                    </View>
                                    <Switch
                                        value={c.isActive !== false}
                                        onValueChange={(v) => toggle('categories', c, 'isActive', v, (fn) => setCats(fn))}
                                        trackColor={{ true: t.success, false: t.border }}
                                    />
                                </View>
                            </Card>
                        )}
                    />
                </>
            )}

            <Sheet visible={showHidden} onClose={() => setShowHidden(false)} title="Hidden in the customer app">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>
                    The app hides a filter or block that would be empty. It shows up on its own once the data exists.
                </Text>
                <ScrollView style={{ maxHeight: 360 }}>
                    {hidden.map((h, i) => (
                        <View key={`${h.type}-${h.id}-${i}`} style={{ paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: t.border }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>{nameOf(h.type === 'block' ? 'block' : h.type === 'filter' ? 'filter' : h.type === 'sort' ? 'sort' : 'x', h.id)}  <Text style={{ color: t.muted, fontWeight: '600' }}>({h.type})</Text></Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{h.reason}</Text>
                        </View>
                    ))}
                </ScrollView>
                <Button title="Close" kind="outline" onPress={() => setShowHidden(false)} style={{ marginTop: spacing.md }} />
            </Sheet>
        </Screen>
    );
}
