// Menu tab: the whole menu at a glance. Category chips, search, "sold out" filter, and every item with its in-stock switch.
// Switching an item off asks for how long (today / 1 hour / 2 hours / until I switch it on), so a sold-out dish comes back
// by itself. Tap an item to edit it; the + button adds one.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useNavigation, NavigationContext, RouteContext } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Empty, Field, Card, Pill, Button, EmbeddedCtx } from '../../components/owners/ui';
import OwnerItemScreen from './OwnerItemScreen';
import { useOwnerDesktop } from '../../utils/common/layout';
import { ItemRow, SoldOutSheet } from '../../components/owners/menuBits';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { itemState } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

function Chip({ label, count, on, onPress, tone }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
            {count > 0 ? (
                <View style={{ marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.25) : (tone === 'bad' ? error : alpha(primary, 0.15)) }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: on ? onPrimary : (tone === 'bad' ? '#FFFFFF' : primary) }}>{count > 99 ? '99+' : count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

export default function OwnerMenuScreen() {
    const nav = useNavigation();
    const { primary, onPrimary, muted, text, border, surface } = useBrand();
    const m = useMenuStore();
    const access = useOwnerStore((st) => st.access);
    const [cat, setCat] = useState('all');            // 'all' or a category id
    const [soldOut, setSoldOut] = useState(false);
    const [q, setQ] = useState('');
    const [asking, setAsking] = useState(null);       // the item being switched off
    const desk = useOwnerDesktop();
    const [panel, setPanel] = useState(null);           // desktop: the item being edited beside the list: { id } or { categoryId } for a new one

    useFocusEffect(useCallback(() => { useMenuStore.getState().load({ quiet: true }); }, []));

    const locked = access !== 'ok';
    const needle = q.trim().toLowerCase();
    const soldCount = useMemo(() => m.products.filter((p) => itemState(p) !== 'on').length, [m.products]);

    // header rows and item rows in one list
    const rows = useMemo(() => {
        const out = [];
        const byCat = new Map();
        for (const p of m.products) {
            if (needle && !p.name.toLowerCase().includes(needle)) continue;
            if (soldOut && itemState(p) === 'on') continue;
            const k = String(p.categoryId);
            if (!byCat.has(k)) byCat.set(k, []);
            byCat.get(k).push(p);
        }
        for (const c of m.categories) {
            if (cat !== 'all' && String(c._id) !== cat) continue;
            const items = byCat.get(String(c._id)) || [];
            if (!items.length && (needle || soldOut)) continue;
            out.push({ type: 'head', key: `h${c._id}`, cat: c, count: items.length });
            items.forEach((p, i) => out.push({ type: 'item', key: `i${p._id}`, item: p, last: i === items.length - 1 }));
            if (!items.length) out.push({ type: 'none', key: `n${c._id}`, cat: c });
        }
        return out;
    }, [m.products, m.categories, cat, soldOut, needle]);

    const onSwitch = async (item, on) => {
        if (on) {
            try { await useMenuStore.getState().setAvailable(item._id, { available: true }); }
            catch (e) { showToast(e.message); }
        } else setAsking(item);
    };
    const pickSoldOut = async (item, body) => {
        setAsking(null);
        if (item._portion) {   // one portion (Half / Full), not the whole item
            const { item: it, group, option } = item._portion;
            try { await useMenuStore.getState().setPortion(it._id, group.id, option.id, false, body); showToast(tr('{n} is sold out', { n: option.name })); } catch (e) { showToast(e.message); }
            return;
        }
        try { await useMenuStore.getState().setAvailable(item._id, body); }
        catch (e) { showToast(e.message); }
    };
    const onPortion = async (item, group, option, on) => {
        if (!on) { setAsking({ name: `${item.name} · ${option.name}`, _portion: { item, group, option } }); return; }   // off: ask for how long, like a whole item
        try {
            await useMenuStore.getState().setPortion(item._id, group.id, option.id, true);
            showToast(tr('{n} is back on the menu', { n: option.name }));
        } catch (e) { showToast(e.message); }
    };
    const onStep = async (item, d) => {
        const qty = Math.max(0, (item.stock?.qty || 0) + d);
        try { await useMenuStore.getState().changeStock(item._id, { qty }); }
        catch (e) { showToast(e.message); }
    };

    const header = (
        <View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Field value={q} onChangeText={setQ} placeholder={tr('Find an item')} maxLength={40} style={{ minHeight: 44 }} /></View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                <Chip label={tr('All')} on={cat === 'all' && !soldOut} onPress={() => { setCat('all'); setSoldOut(false); }} />
                <Chip label={tr('Sold out')} count={soldCount} tone="bad" on={soldOut} onPress={() => setSoldOut(!soldOut)} />
                {m.categories.map((c) => (
                    <Chip key={c._id} label={c.name} on={cat === String(c._id)} onPress={() => setCat(cat === String(c._id) ? 'all' : String(c._id))} />
                ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 6 }}>
                <Pressable onPress={() => nav.navigate('OwnerCategories')} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22 }} hitSlop={6}>
                    <Ionicons name="list" size={17} color={primary} />
                    <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Categories')}</Text>
                </Pressable>
                <Pressable onPress={() => nav.navigate('OwnerCollections')} style={{ flexDirection: 'row', alignItems: 'center' }} hitSlop={6}>
                    <Ionicons name="albums" size={17} color={primary} />
                    <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Collections')}</Text>
                </Pressable>
            </View>
            {m.truncated ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 }}>{tr('Showing the first 600 items. Use search or a category to find the rest.')}</Text> : null}
        </View>
    );

    const renderRow = ({ item: r }) => {
        if (r.type === 'head') {
            return (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
                    <Text style={{ color: text, fontSize: 16, fontWeight: '900' }}>{r.cat.name}</Text>
                    <Text style={{ color: muted, marginLeft: 8, fontWeight: '700' }}>{r.count}</Text>
                    {r.cat.isActive === false ? <View style={{ marginLeft: 8 }}><Pill label={tr('Hidden')} color={muted} /></View> : null}
                </View>
            );
        }
        if (r.type === 'none') {
            return (
                <Pressable onPress={() => nav.navigate('OwnerItem', { categoryId: String(r.cat._id) })} style={{ marginHorizontal: 16, paddingVertical: 10 }}>
                    <Text style={{ color: primary, fontWeight: '700' }}>{tr('No items yet. Add one')}</Text>
                </Pressable>
            );
        }
        return (
            <View style={{ marginHorizontal: 16, paddingHorizontal: 12, backgroundColor: surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: border }}>
                <ItemRow item={r.item} last={r.last} onOpen={() => nav.navigate('OwnerItem', { id: String(r.item._id) })} onSwitch={onSwitch} onStep={onStep} onPortion={onPortion} />
            </View>
        );
    };

    const empty = m.loading ? (
        <ListShimmer />
    ) : m.error ? (
        <Empty icon={locked ? 'lock-closed-outline' : 'cloud-offline-outline'} title={locked ? tr('The menu is locked') : tr('Could not load the menu')} hint={m.error} />
    ) : !m.categories.length ? (
        <View>
            <Empty icon="restaurant-outline" title={tr('Your menu is empty')} hint={tr('Add your first item. You can type a new category while adding it.')} />
            <View style={{ paddingHorizontal: 16 }}><Button label={tr('Add the first item')} icon="add" onPress={() => nav.navigate('OwnerItem', {})} /></View>
        </View>
    ) : (
        <Empty icon="search-outline" title={soldOut ? tr('Nothing is sold out') : tr('No item found')} hint={soldOut ? tr('Every item is in stock.') : tr('Try another name or category.')} />
    );

    // The owner on a computer: the menu as a grid of items by category, and the item opens in a panel on the right (the same edit page as the phone, inside the panel)
    if (desk) {
        const sections = [];
        rows.forEach((r) => {
            if (r.type === 'head') sections.push({ key: r.key, cat: r.cat, count: r.count, items: [] });
            else if (r.type === 'item' && sections.length) sections[sections.length - 1].items.push(r.item);
        });
        const closePanel = () => setPanel(null);
        const fakeNav = { ...nav, goBack: closePanel, canGoBack: () => true };
        const colW = panel ? '50%' : '33.333%';
        return (
            <OwnerScreen title={tr('Menu')} scroll={false}>
                <View style={{ flex: 1, flexDirection: 'row' }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 12 }}>
                            <View style={{ width: 300 }}><Field value={q} onChangeText={setQ} placeholder={tr('Find an item')} maxLength={40} style={{ minHeight: 42 }} /></View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginLeft: 14 }}>
                                <Chip label={tr('All')} on={cat === 'all' && !soldOut} onPress={() => { setCat('all'); setSoldOut(false); }} />
                                <Chip label={tr('Sold out')} count={soldCount} tone="bad" on={soldOut} onPress={() => setSoldOut(!soldOut)} />
                                {m.categories.map((c) => <Chip key={c._id} label={c.name} on={cat === String(c._id)} onPress={() => setCat(cat === String(c._id) ? 'all' : String(c._id))} />)}
                            </ScrollView>
                            <Pressable onPress={() => nav.navigate('OwnerCategories')} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', marginLeft: 10, paddingHorizontal: 12, height: 40, borderRadius: 20, backgroundColor: hovered ? border : 'transparent', cursor: 'pointer' })}>
                                <Ionicons name="list" size={17} color={primary} /><Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Categories')}</Text>
                            </Pressable>
                            <Pressable onPress={() => nav.navigate('OwnerCollections')} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 40, borderRadius: 20, backgroundColor: hovered ? border : 'transparent', cursor: 'pointer' })}>
                                <Ionicons name="albums" size={17} color={primary} /><Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Collections')}</Text>
                            </Pressable>
                            {!locked && !m.error ? (
                                <Pressable onPress={() => setPanel({ categoryId: cat !== 'all' ? cat : undefined, n: Date.now() })} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8, paddingHorizontal: 18, height: 42, borderRadius: 21, backgroundColor: primary, cursor: 'pointer' }}>
                                    <Ionicons name="add" size={20} color={onPrimary} /><Text style={{ color: onPrimary, fontWeight: '900', marginLeft: 6 }}>{tr('Add item')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
                            {m.loading || m.error || !sections.length ? <View style={{ marginTop: 8 }}>{empty}</View> : sections.map((sec) => (
                                <View key={sec.key} style={{ marginBottom: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 12, paddingBottom: 8 }}>
                                        <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{sec.cat.name}</Text>
                                        <Text style={{ color: muted, marginLeft: 8, fontWeight: '700' }}>{sec.count}</Text>
                                        {sec.cat.isActive === false ? <View style={{ marginLeft: 8 }}><Pill label={tr('Hidden')} color={muted} /></View> : null}
                                    </View>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {sec.items.map((it) => (
                                            <View key={it._id} style={{ width: colW, padding: 6 }}>
                                                <View style={{ paddingHorizontal: 14, borderRadius: 16, backgroundColor: surface, borderWidth: panel && String(panel.id) === String(it._id) ? 2 : 1, borderColor: panel && String(panel.id) === String(it._id) ? primary : border }}>
                                                    <ItemRow item={it} last onOpen={() => setPanel({ id: String(it._id) })} onSwitch={onSwitch} onStep={onStep} onPortion={onPortion} />
                                                </View>
                                            </View>
                                        ))}
                                        {!sec.items.length ? (
                                            <Pressable onPress={() => setPanel({ categoryId: String(sec.cat._id), n: Date.now() })} style={{ padding: 14 }}><Text style={{ color: primary, fontWeight: '700' }}>{tr('No items yet. Add one')}</Text></Pressable>
                                        ) : null}
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                    {panel ? (
                        <View style={{ width: 500, borderLeftWidth: 1, borderLeftColor: border, backgroundColor: surface }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: border }}>
                                <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '900' }}>{panel.id ? tr('Edit item') : tr('New item')}</Text>
                                <Pressable onPress={closePanel} accessibilityLabel={tr('Close')} style={({ hovered }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? border : 'transparent', cursor: 'pointer' })}><Ionicons name="close" size={22} color={text} /></Pressable>
                            </View>
                            <NavigationContext.Provider value={fakeNav}>
                                <RouteContext.Provider value={{ key: 'menu-panel', name: 'OwnerItem', params: { id: panel.id, categoryId: panel.categoryId } }}>
                                    <EmbeddedCtx.Provider value>
                                        <OwnerItemScreen key={panel.id || `new${panel.n}`} />
                                    </EmbeddedCtx.Provider>
                                </RouteContext.Provider>
                            </NavigationContext.Provider>
                        </View>
                    ) : null}
                </View>
                <SoldOutSheet item={asking} onClose={() => setAsking(null)} onPick={pickSoldOut} />
            </OwnerScreen>
        );
    }

    return (
        <OwnerScreen title={tr('Menu')} scroll={false}>
            <FlatList
                data={m.loading || m.error ? [] : rows}
                keyExtractor={(r) => r.key}
                renderItem={renderRow}
                ListHeaderComponent={header}
                ListEmptyComponent={empty}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={<RefreshControl refreshing={m.refreshing} onRefresh={() => { useMenuStore.getState().load({ quiet: true }); }} tintColor={primary} colors={[primary]} />}
                ListFooterComponent={<View style={{ height: 1 }} />}
            />
            {!locked && !m.error ? (
                <Pressable
                    onPress={() => nav.navigate('OwnerItem', { categoryId: cat !== 'all' ? cat : undefined })}
                    style={{ position: 'absolute', right: 20, bottom: 24, flexDirection: 'row', alignItems: 'center', backgroundColor: primary, paddingHorizontal: 18, height: 54, borderRadius: 27, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
                >
                    <Ionicons name="add" size={24} color={onPrimary} />
                    <Text numberOfLines={1} style={{ color: onPrimary, fontWeight: '900', marginLeft: 6 }}>{tr('Add item')}</Text>
                </Pressable>
            ) : null}
            <SoldOutSheet item={asking} onClose={() => setAsking(null)} onPick={pickSoldOut} />
        </OwnerScreen>
    );
}
