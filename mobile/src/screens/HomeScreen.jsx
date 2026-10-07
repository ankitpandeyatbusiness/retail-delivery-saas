import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, Pressable, FlatList, ScrollView, Animated, ActivityIndicator, StyleSheet, useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../ui/kit';
import { ItemCard, Tile, CartBar, closedText, showToast, tint } from '../ui/shop';
import FilterDialog from './FilterDialog';
import { useThemeStore } from '../store/useThemeStore';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useMenuStore, useCartStore, useFavStore } from '../store/shopStores';
import { useFilterStore, applyFilters, countActive } from '../store/useFilterStore';

const Gap = () => <View style={{ width: 10 }} />;
const VIEW_CFG = { itemVisiblePercentThreshold: 1 };
const PALETTE = [['#D32F2F', '#000000CC'], ['#1E8E3E', '#0A3D1A'], ['#F59E0B', '#B45309']];

/* ---------------- header (scrolls away) ---------------- */
function Header() {
    const nav = useNavigation();
    const { primary, text } = useBrand();
    const theme = useThemeStore((st) => st.theme);
    const full = useHomeStore((st) => st.full);
    const count = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity, 0));
    const open = full.restaurant.isOpen;
    const logo = typeof theme.logo === 'string' ? theme.logo : null;
    const mins = full.orders.prepTimeMin;
    return (
        <View style={s.hd}>
            <View style={[s.logo, { backgroundColor: primary }]}>
                {logo ? <Image source={{ uri: logo }} style={s.logoImg} contentFit="cover" />
                    : <Text style={s.logoTxt}>{(theme.name || '?')[0]}</Text>}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[s.hdName, { color: text }]} numberOfLines={1}>{theme.name}</Text>
                <Text style={{ color: open ? '#1E8E3E' : '#D32F2F', fontWeight: '600', fontSize: 12 }}>
                    {open ? `Open${mins ? ` · ${mins} min` : ''}` : 'Closed'}
                </Text>
            </View>
            {full.offers.couponsEnabled ? (
                <Pressable onPress={() => nav.navigate('Offers')} style={s.ic} hitSlop={8}><Text style={s.icTxt}>🏷</Text></Pressable>
            ) : null}
            <Pressable onPress={() => nav.navigate('Cart')} style={s.ic} hitSlop={8}>
                <Text style={s.icTxt}>🛒</Text>
                {count ? <View style={[s.badge, { backgroundColor: primary }]}><Text style={s.badgeTxt}>{count}</Text></View> : null}
            </Pressable>
        </View>
    );
}

/* ---------------- sticky search bar ---------------- */
function Slider({ names }) {
    const y = useRef(new Animated.Value(0)).current;
    const step = useRef(0);
    const key = names.join('|');
    useEffect(() => {
        step.current = 0;
        y.setValue(0);
        if (names.length < 2) return undefined;
        const t = setInterval(() => {
            const next = step.current + 1;
            Animated.timing(y, { toValue: -20 * next, duration: 350, useNativeDriver: true }).start(() => {
                if (next >= names.length) { y.setValue(0); step.current = 0; } else step.current = next;
            });
        }, 2800);
        return () => clearInterval(t);
    }, [key]);
    if (!names.length) return <Text style={s.ph}>Search dishes</Text>;
    return (
        <View style={{ height: 20, overflow: 'hidden', flex: 1 }}>
            <Animated.View style={{ transform: [{ translateY: y }] }}>
                {[...names, names[0]].map((n, i) => <Text key={i} style={s.ph} numberOfLines={1}>Search "{n}"</Text>)}
            </Animated.View>
        </View>
    );
}

function VegSwitch({ on, onPress }) {
    return (
        <Pressable onPress={onPress} style={{ alignItems: 'center' }}>
            <Text style={s.vegTxt}>VEG</Text>
            <View style={[s.track, { backgroundColor: on ? '#0F8A3C' : '#CCCCCC' }]}>
                <View style={[s.knob, { left: on ? 18 : 2 }]} />
            </View>
        </Pressable>
    );
}

function Cats() {
    const { primary, text } = useBrand();
    const chips = useHomeStore((st) => st.categories);
    const sel = useFilterStore((st) => st.category);
    const setCat = useFilterStore((st) => st.setCategory);
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats}>
            {chips.map((c) => {
                const on = sel === c._id;
                return (
                    <Pressable key={c._id} onPress={() => setCat(c._id)} style={s.cat}>
                        <View style={[s.catCircle, { backgroundColor: tint(primary), borderColor: on ? primary : 'transparent' }]}>
                            {c.image ? <Image source={{ uri: c.image }} style={s.catImg} contentFit="cover" />
                                : <Text style={{ fontWeight: '800', color: primary, fontSize: 20 }}>{c.name[0]}</Text>}
                        </View>
                        <Text numberOfLines={1} style={[s.catName, { color: on ? primary : text }]}>{c.name}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function StickyBar({ names, stuck, grouped }) {
    const nav = useNavigation();
    const { text, background } = useBrand();
    const full = useHomeStore((st) => st.full);
    const foodMode = useHomeStore((st) => st.config.foodMode);
    const veg = useFilterStore((st) => st.active.includes('veg_only'));
    const toggle = useFilterStore((st) => st.toggleFilter);
    return (
        <View style={[s.sticky, { backgroundColor: background }]}>
            <View style={s.searchRow}>
                <Pressable style={s.sb} onPress={() => nav.navigate('Search')}>
                    <Text>🔍</Text>
                    <Slider names={names} />
                    <Text onPress={() => showToast('Voice search coming soon')}>🎤</Text>
                </Pressable>
                {full.features.vegToggle && foodMode === 'mixed' ? <VegSwitch on={veg} onPress={() => toggle('veg_only')} /> : null}
            </View>
            {stuck.cats ? <Cats /> : null}
            {grouped && stuck.sec ? <Text style={[s.stuckSec, { color: text }]}>{stuck.sec}</Text> : null}
        </View>
    );
}

/* ---------------- banners, offers, filters row, strips ---------------- */
function Banners({ list, onOrder }) {
    const { width } = useWindowDimensions();
    const w = Math.round(width * 0.86);
    return (
        <FlatList
            data={list} horizontal showsHorizontalScrollIndicator={false}
            snapToInterval={w + 10} decelerationRate="fast"
            keyExtractor={(b) => b._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
            renderItem={({ item: b, index }) => {
                const g = PALETTE[index % 3];
                const { primary } = useBrandStatic();
                return (
                    <View style={[s.banner, { width: w }]}>
                        {b.image
                            ? <><Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                <LinearGradient colors={['#000000AA', '#00000010']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} /></>
                            : <LinearGradient colors={index % 3 === 0 ? [primary, '#000000CC'] : g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
                        <Text style={s.bTitle} numberOfLines={2}>{b.title}</Text>
                        {b.subtitle ? <Text style={s.bSub} numberOfLines={1}>{b.subtitle}</Text> : null}
                        <Pressable onPress={() => onOrder(b)} style={s.bPill}><Text style={s.bPillTxt}>Order now</Text></Pressable>
                    </View>
                );
            }}
        />
    );
}
const useBrandStatic = () => ({ primary: useThemeStore.getState().theme.colors.primary });

function OffersStrip({ list }) {
    const nav = useNavigation();
    const { primary, text } = useBrand();
    return (
        <View>
            <View style={s.secRow}>
                <Text style={[s.secTitle, { color: text }]}>Offers for you</Text>
                <Pressable onPress={() => nav.navigate('Offers')}><Text style={[s.link, { color: primary }]}>See all ›</Text></Pressable>
            </View>
            <FlatList
                horizontal data={list} showsHorizontalScrollIndicator={false}
                keyExtractor={(o) => o._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item: o }) => (
                    <Pressable onPress={() => nav.navigate('Offers')} style={[s.offer, { borderColor: primary, backgroundColor: tint(primary) }]}>
                        <Text style={[s.offerCode, { color: primary }]}>{o.code}</Text>
                        <Text style={s.offerDesc} numberOfLines={2}>
                            {o.description || (o.discountType === 'percent' ? `${o.discountValue}% off` : `₹${o.discountValue} off`)}
                        </Text>
                        {o.minOrder ? <Text style={s.offerMin}>Min order ₹{o.minOrder}</Text> : null}
                    </Pressable>
                )}
            />
        </View>
    );
}

function Chip({ label, on, onPress, badge }) {
    const { primary } = useBrand();
    return (
        <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: primary, borderColor: primary }]}>
            <Text style={[s.chipTxt, on && { color: '#FFFFFF' }]}>{label}</Text>
            {badge ? <View style={[s.chipBadge, { backgroundColor: primary }]}><Text style={s.badgeTxt}>{badge}</Text></View> : null}
        </Pressable>
    );
}

function FiltersRow({ onOpen }) {
    const config = useHomeStore((st) => st.config);
    const f = useFilterStore();
    const n = countActive(f);
    const quick = [];
    if (config.sortOptions.includes('price_low')) {
        quick.push(['Price: low', f.sort === 'price_low', () => f.setSort(f.sort === 'price_low' ? null : 'price_low')]);
    }
    [['bestseller', 'Bestseller'], ['rating_4', 'Rating 4+'], ['offers', 'Offers']].forEach(([id, label]) => {
        if (config.filters.includes(id)) quick.push([label, f.active.includes(id), () => f.toggleFilter(id)]);
    });
    const canOpen = config.filters.length > 0 || config.sortOptions.length > 1;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fl}>
            {canOpen ? <Chip label="⚙ Filters" on={false} badge={n} onPress={onOpen} /> : null}
            {quick.map((q) => <Chip key={q[0]} label={q[0]} on={q[1]} onPress={q[2]} />)}
        </ScrollView>
    );
}

function Strip({ r }) {
    const nav = useNavigation();
    const { primary, text } = useBrand();
    return (
        <View>
            <View style={s.secRow}>
                <View style={{ flex: 1 }}>
                    <Text style={[s.secTitle, { color: text }]}>{r.title}</Text>
                    {r.sub ? <Text style={s.secSub}>{r.sub}</Text> : null}
                </View>
                {r.see ? <Pressable onPress={() => nav.navigate(r.see)}><Text style={[s.link, { color: primary }]}>See all ›</Text></Pressable> : null}
            </View>
            <FlatList
                horizontal data={r.items} showsHorizontalScrollIndicator={false}
                keyExtractor={(i) => i._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item }) => <Tile item={item} />}
            />
        </View>
    );
}

/* ---------------- the screen ---------------- */
export default function HomeScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const brand = useBrand();
    const user = useAuthStore((st) => st.user);
    const { config, full, categories: chips, banners, offers } = useHomeStore();
    const { categories: menuCats, recommended, festival, combo, loaded, errorStatus, load: loadMenu } = useMenuStore();
    const f = useFilterStore();
    const listRef = useRef(null);
    const [dlg, setDlg] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [stuck, setStuck] = useState({ cats: false, sec: '' });

    useEffect(() => { useCartStore.getState().hydrate(); loadMenu(); }, []);
    useEffect(() => {
        if (user && full.features.favourites) useFavStore.getState().load();
        else useFavStore.getState().reset();
    }, [user, full.features.favourites]);

    const refresh = async () => {
        setRefreshing(true);
        await Promise.all([useHomeStore.getState().load(), loadMenu()]);
        setRefreshing(false);
    };

    const all = useMemo(() => menuCats.flatMap((c) => c.items), [menuCats]);
    const names = useMemo(
        () => [...all].sort((a, b) => (b.isBestseller ? 1 : 0) - (a.isBestseller ? 1 : 0)).slice(0, 4).map((i) => i.name),
        [all],
    );
    const filtered = useMemo(
        () => applyFilters(all, f, full.ratings.minCount),
        [all, f.category, f.active, f.sort, f.price, f.spice, f.serves, f.weight, full.ratings.minCount],
    );
    const grouped = full.menu.groupByCategory && !f.category;

    const rows = useMemo(() => {
        const R = [{ t: 'header' }];
        const B = config.blocks;
        if (B.includes('search')) R.push({ t: 'search' });
        if (!full.restaurant.isOpen) R.push({ t: 'closed' });

        const pushItems = (list, cat) => {
            if (config.cardStyle === 'grid') {
                for (let i = 0; i < list.length; i += 2) R.push({ t: 'pair', a: list[i], b: list[i + 1], cat });
            } else list.forEach((item) => R.push({ t: 'item', item, cat }));
        };

        for (const b of B) {
            if (b === 'banner' && banners.length) R.push({ t: 'banner' });
            else if (b === 'categories' && chips.length) R.push({ t: 'cats' });
            else if (b === 'filters') R.push({ t: 'filters' });
            else if (b === 'offers' && offers.length && full.offers.couponsEnabled && full.offers.showOnHome) R.push({ t: 'offers' });
            else if (b === 'bestsellers' && recommended.length) R.push({ t: 'strip', id: 'best', title: 'Bestsellers', sub: 'Most ordered', items: recommended, see: 'Bestsellers' });
            else if (b === 'festival') festival.forEach((c) => R.push({ t: 'strip', id: `f${c.id}`, title: c.title, sub: c.subtitle || '', items: c.products }));
            else if (b === 'combos') combo.forEach((c) => R.push({ t: 'strip', id: `c${c.id}`, title: c.title, sub: c.subtitle || '', items: c.products }));
            else if (b === 'new_arrivals') {
                const news = all.filter((i) => i.isNewArrival).slice(0, 10);
                if (news.length) R.push({ t: 'strip', id: 'new', title: 'New arrivals', sub: 'Just added', items: news });
            } else if (b === 'items') {
                if (!loaded) R.push({ t: 'loading' });
                else if (!all.length && errorStatus) R.push({ t: 'error' });
                else if (!filtered.length) R.push({ t: 'empty' });
                else if (grouped) {
                    const by = new Map();
                    filtered.forEach((p) => { const k = String(p.categoryId); if (!by.has(k)) by.set(k, []); by.get(k).push(p); });
                    menuCats.forEach((c) => {
                        const A = by.get(String(c._id));
                        if (A?.length) { R.push({ t: 'sec', title: c.name, sub: `${A.length} items`, cat: c.name }); pushItems(A, c.name); }
                    });
                } else {
                    const nm = chips.find((c) => c._id === f.category)?.name;
                    R.push({ t: 'sec', title: nm || 'Full menu', sub: `${filtered.length} dishes` });
                    pushItems(filtered);
                }
            }
        }
        return R;
    }, [config, full, banners, chips, offers, recommended, festival, combo, all, filtered, grouped, menuCats, loaded, errorStatus, f.category]);

    const searchIdx = rows.findIndex((r) => r.t === 'search');
    const catsIdx = rows.findIndex((r) => r.t === 'cats');
    const menuIdx = rows.findIndex((r) => ['sec', 'empty', 'loading', 'error'].includes(r.t));
    const meta = useRef({});
    meta.current = { rows, catsIdx, searchIdx };

    // which rows are on screen -> copy categories into the sticky bar, and show the current section name
    const onViewable = useRef(({ viewableItems }) => {
        const { rows: R, catsIdx: ci, searchIdx: si } = meta.current;
        const idxs = viewableItems.map((v) => v.index).filter((i) => typeof i === 'number' && i > si).sort((a, b) => a - b);
        let cats = false;
        let sec = '';
        if (idxs.length) {
            cats = ci >= 0 && idxs[0] > ci;
            for (const i of idxs) { if (R[i] && R[i].cat) { sec = R[i].cat; break; } }
        }
        setStuck((p) => (p.cats === cats && p.sec === sec ? p : { cats, sec }));
    }).current;

    const onOrder = (b) => {
        if (b.couponCode) nav.navigate('Offers');
        else if (menuIdx >= 0) listRef.current?.scrollToIndex({ index: menuIdx, animated: true });
    };

    const renderRow = ({ item: r }) => {
        switch (r.t) {
            case 'header': return <Header />;
            case 'search': return <StickyBar names={names} stuck={stuck} grouped={grouped} />;
            case 'closed': return <View style={s.closed}><Text style={s.closedTxt}>{closedText(full)}</Text></View>;
            case 'banner': return <Banners list={banners} onOrder={onOrder} />;
            case 'cats': return <Cats />;
            case 'filters': return <FiltersRow onOpen={() => setDlg(true)} />;
            case 'offers': return <OffersStrip list={offers} />;
            case 'strip': return <Strip r={r} />;
            case 'sec': return (
                <View style={s.sec}>
                    <Text style={[s.secTitle, { color: brand.text }]}>{r.title}</Text>
                    {r.sub ? <Text style={s.secSub}>{r.sub}</Text> : null}
                </View>
            );
            case 'item': return <ItemCard item={r.item} variant={config.cardStyle} />;
            case 'pair': return (
                <View style={s.pair}>
                    <View style={{ flex: 1 }}><ItemCard item={r.a} variant="grid" /></View>
                    <View style={{ flex: 1 }}>{r.b ? <ItemCard item={r.b} variant="grid" /> : null}</View>
                </View>
            );
            case 'loading': return <ActivityIndicator style={{ margin: 32 }} color={brand.primary} />;
            case 'error': return (
                <View style={s.empty}>
                    <Text style={s.emptyTxt}>Could not load the menu</Text>
                    <Pressable onPress={loadMenu}><Text style={[s.link, { color: brand.primary, marginTop: 10 }]}>Try again</Text></Pressable>
                </View>
            );
            case 'empty': return <View style={s.empty}><Text style={s.emptyTxt}>{full.labels.emptySearch}</Text></View>;
            default: return null;
        }
    };

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: brand.background }}>
            <FlashList
                ref={listRef}
                data={rows}
                renderItem={renderRow}
                keyExtractor={(r, i) => (r.item ? `i${r.item._id}` : r.a ? `p${r.a._id}` : r.id ? `s${r.id}` : `${r.t}${r.title || ''}${r.t === 'sec' ? '' : i}`)}
                getItemType={(r) => r.t}
                stickyHeaderIndices={searchIdx >= 0 ? [searchIdx] : undefined}
                extraData={[stuck, grouped]}
                onViewableItemsChanged={onViewable}
                viewabilityConfig={VIEW_CFG}
                refreshing={refreshing}
                onRefresh={refresh}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 90 }}
            />
            <CartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
        </View>
    );
}

const s = StyleSheet.create({
    hd: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    logo: { width: 40, height: 40, borderRadius: 20, marginRight: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    logoImg: { width: 40, height: 40 },
    logoTxt: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
    hdName: { fontSize: 18, fontWeight: '800' },
    ic: { paddingHorizontal: 6, paddingVertical: 4, marginLeft: 4 },
    icTxt: { fontSize: 22 },
    badge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    badgeTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
    sticky: { paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E3E3E3', elevation: 3 },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 7 },
    sb: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 44, borderWidth: 1, borderColor: '#E3E3E3', borderRadius: 14, paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
    ph: { flex: 1, height: 20, lineHeight: 20, fontSize: 13, color: '#777777', marginLeft: 8 },
    vegTxt: { fontSize: 9, fontWeight: '800', color: '#0F8A3C', marginBottom: 2 },
    track: { width: 34, height: 18, borderRadius: 9, marginLeft: 0 },
    knob: { position: 'absolute', top: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
    stuckSec: { fontSize: 13, fontWeight: '800', paddingHorizontal: 16, paddingTop: 4 },
    cats: { paddingHorizontal: 16, paddingVertical: 10 },
    cat: { width: 66, alignItems: 'center', marginRight: 10 },
    catCircle: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    catImg: { width: 54, height: 54, borderRadius: 27 },
    catName: { marginTop: 4, fontSize: 11, fontWeight: '600' },
    closed: { backgroundColor: '#FDECEA', paddingHorizontal: 16, paddingVertical: 8 },
    closedTxt: { color: '#B3261E', fontWeight: '600', fontSize: 12 },
    hpad: { paddingHorizontal: 16, paddingVertical: 8 },
    banner: { height: 150, borderRadius: 20, overflow: 'hidden', padding: 18, justifyContent: 'center' },
    bTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', maxWidth: '65%' },
    bSub: { color: '#FFFFFF', fontSize: 12, marginTop: 4 },
    bPill: { alignSelf: 'flex-start', marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 },
    bPillTxt: { fontSize: 12, fontWeight: '800', color: '#111111' },
    secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12 },
    sec: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
    secTitle: { fontSize: 16, fontWeight: '800' },
    secSub: { fontSize: 11, color: '#777777', marginTop: 1 },
    link: { fontSize: 12, fontWeight: '700' },
    offer: { width: 200, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, padding: 12 },
    offerCode: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
    offerDesc: { fontSize: 12, color: '#444444', marginTop: 3 },
    offerMin: { fontSize: 11, color: '#777777', marginTop: 3 },
    fl: { paddingHorizontal: 16, paddingVertical: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 18, backgroundColor: '#FFFFFF', marginRight: 8 },
    chipTxt: { fontSize: 12, fontWeight: '600', color: '#333333' },
    chipBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, marginLeft: 6, alignItems: 'center', justifyContent: 'center' },
    pair: { flexDirection: 'row', paddingHorizontal: 10 },
    empty: { padding: 36, alignItems: 'center' },
    emptyTxt: { fontSize: 14, color: '#777777' },
});