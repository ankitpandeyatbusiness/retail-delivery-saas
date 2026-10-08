// src/screens/HomeScreen.jsx
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
    View, Text, Pressable, FlatList, ScrollView, Animated, Easing, ActivityIndicator, StyleSheet, useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, mix, onColor } from '../components/ui/kit';
import { ItemCard, Tile, CartBar, closedText, showToast, tint } from '../components/ui/shop';
import FilterDialog from './FilterDialog';
import { useThemeStore } from '../store/useThemeStore';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useMenuStore, useCartStore, useFavStore } from '../store/shopStores';
import { useFilterStore, applyFilters, countActive } from '../store/useFilterStore';
import { Slider, VegSwitch, Cats, Collapse, FadeCollapse, useVoice, VoiceOverlay } from '../components/ui/finder';
import { CopyIcon } from '../components/ui/copyCode';

const Gap = () => <View style={{ width: 12 }} />;
const VIEW_CFG = { itemVisiblePercentThreshold: 1 };
const glass = 'rgba(255,255,255,0.18)';

/* ---------------- storefront header (scrolls away) ---------------- */
function Header() {
    const nav = useNavigation();
    const { primaryLight, primaryDark, onPrimary } = useBrand();
    const theme = useThemeStore((st) => st.theme);
    const full = useHomeStore((st) => st.full);
    const count = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity, 0));
    const open = full.restaurant.isOpen;
    const logo = typeof theme.logo === 'string' ? theme.logo : null;
    const mins = full.orders.prepTimeMin;
    const fee = full.orders.deliveryFee || {};
    const delivers = (full.orders.types || []).includes('delivery');

    const chips = [];
    if (full.features.prepTime && mins) chips.push({ icon: 'time-outline', text: `${mins} min` });
    if (delivers) {
        if (fee.type === 'free' || !fee.amount) chips.push({ icon: 'bicycle-outline', text: 'Free delivery' });
        else if (fee.freeAbove > 0) chips.push({ icon: 'bicycle-outline', text: `Free above ₹${fee.freeAbove}` });
        else chips.push({ icon: 'bicycle-outline', text: `₹${fee.amount} delivery` });
    }
    if (full.orders.minOrder > 0) chips.push({ icon: 'bag-check-outline', text: `Min ₹${full.orders.minOrder}` });

    return (
        <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hd}>
            <View style={[s.blob, { top: -50, right: -40, width: 170, height: 170 }]} />
            <View style={[s.blob, { bottom: -60, left: -30, width: 130, height: 130 }]} />
            <View style={s.hdRow}>
                <View style={s.logo}>
                    {logo ? <Image source={{ uri: logo }} style={s.logoImg} contentFit="cover" />
                        : <Text style={[s.logoTxt, { color: primaryDark }]}>{(theme.name || '?')[0].toUpperCase()}</Text>}
                </View>
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={[s.hdName, { color: onPrimary }]} numberOfLines={1}>{theme.name}</Text>
                    {theme.tagline ? <Text style={[s.hdTag, { color: onPrimary }]} numberOfLines={1}>{theme.tagline}</Text> : null}
                </View>
                {full.offers.couponsEnabled ? (
                    <Pressable onPress={() => nav.navigate('Offers')} style={s.ic} hitSlop={6}>
                        <Ionicons name="pricetags-outline" size={20} color={onPrimary} />
                    </Pressable>
                ) : null}
                <Pressable onPress={() => nav.navigate('Cart')} style={[s.ic, { marginLeft: 8 }]} hitSlop={6}>
                    <Ionicons name="bag-handle-outline" size={21} color={onPrimary} />
                    {count ? <View style={[s.cBadge, { backgroundColor: onPrimary }]}><Text style={[s.cBadgeTxt, { color: primaryDark }]}>{count}</Text></View> : null}
                </Pressable>
            </View>
            <View style={s.chipRow}>
                <View style={s.hChip}>
                    <View style={[s.statusDot, { backgroundColor: open ? '#4ADE80' : '#FF6B6B' }]} />
                    <Text style={[s.hChipTxt, { color: onPrimary }]}>{open ? 'Open now' : 'Closed'}</Text>
                </View>
                {chips.map((c) => (
                    <View key={c.text} style={s.hChip}>
                        <Ionicons name={c.icon} size={13} color={onPrimary} />
                        <Text style={[s.hChipTxt, { color: onPrimary, marginLeft: 4 }]}>{c.text}</Text>
                    </View>
                ))}
            </View>
        </LinearGradient>
    );
}



function StickyBar({ names, onHeight, onMic }) {
    const nav = useNavigation();
    const { background, surface, border, muted, primary } = useBrand();
    const full = useHomeStore((st) => st.full);
    const foodMode = useHomeStore((st) => st.config.foodMode);
    const veg = useFilterStore((st) => st.active.includes('veg_only'));
    const toggle = useFilterStore((st) => st.toggleFilter);
    return (
        <View
            onLayout={(e) => onHeight(Math.round(e.nativeEvent.layout.height))}
            style={[s.sticky, { backgroundColor: background, borderBottomColor: border }]}
        >
            <View style={s.searchRow}>
                <Pressable style={[s.sb, { backgroundColor: surface, borderColor: border }]} onPress={() => nav.navigate('Search')}>
                    <Ionicons name="search" size={18} color={primary} />
                    <Slider names={names} />
                    <Pressable onPress={onMic} hitSlop={8}>
                        <Ionicons name="mic-outline" size={19} color={muted} />
                    </Pressable>
                </Pressable>
                {full.features.vegToggle && foodMode === 'mixed' ? <VegSwitch on={veg} onPress={() => toggle('veg_only')} /> : null}
            </View>
        </View>
    );
}

// Floats under the sticky search bar. It has its own state, so scrolling never re-renders the screen.
const StuckPanel = forwardRef(function StuckPanel({ top, grouped }, ref) {
    const { text, background, border } = useBrand();
    const [st, setSt] = useState({ cats: false, sec: '' });
    const a = useRef(new Animated.Value(0)).current;

    useImperativeHandle(ref, () => ({
        set: (cats, sec) => setSt((p) => (p.cats === cats && p.sec === sec ? p : { cats, sec })),
    }), []);

    useEffect(() => {
        Animated.timing(a, { toValue: st.cats ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    }, [st.cats]);

    const ty = a.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] });
    return (
        <View pointerEvents={st.cats ? 'auto' : 'none'} style={[s.panelWrap, { top }]}>
            <Animated.View style={{ backgroundColor: background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border, opacity: a, transform: [{ translateY: ty }] }}>
                <Cats />
                {grouped && st.sec ? <Text style={[s.stuckSec, { color: text, paddingBottom: 8 }]}>{st.sec}</Text> : null}
            </Animated.View>
        </View>
    );
});

/* ---------------- banners ---------------- */
function Banners({ list, onOrder }) {
    const { width } = useWindowDimensions();
    const { primary, primaryLight, primaryDark, border } = useBrand();
    const w = width - 32;
    const snap = w + 12;
    const ref = useRef(null);
    const idx = useRef(0);
    const [cur, setCur] = useState(0);

    const grads = [
        [primaryLight, primaryDark],
        [primaryDark, mix(primaryDark, '#000000', 0.5)],
        [mix(primary, '#000000', 0.2), mix(primaryLight, '#FFFFFF', 0.25)],
    ];

    useEffect(() => {
        if (list.length < 2) return undefined;
        const t = setInterval(() => {
            const next = (idx.current + 1) % list.length;
            idx.current = next;
            ref.current?.scrollToOffset({ offset: next * snap, animated: true });
            setCur(next);
        }, 4500);
        return () => clearInterval(t);
    }, [list.length, snap]);

    return (
        <View>
            <FlatList
                ref={ref}
                data={list} horizontal showsHorizontalScrollIndicator={false}
                snapToInterval={snap} decelerationRate="fast" disableIntervalMomentum
                onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
                    idx.current = i;
                    setCur(i);
                }}
                keyExtractor={(b) => b._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item: b, index }) => {
                    const g = grads[index % 3];
                    const fg = b.image ? '#FFFFFF' : onColor(g[0]);
                    return (
                        <View style={[s.banner, { width: w }]}>
                            {b.image ? (
                                <>
                                    <Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                    <LinearGradient colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0.05)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                                </>
                            ) : (
                                <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
                                    <View style={[s.blob, { top: -40, right: -30, width: 150, height: 150 }]} />
                                    <View style={[s.blob, { bottom: -50, right: 60, width: 110, height: 110 }]} />
                                </LinearGradient>
                            )}
                            <Text style={[s.bTitle, { color: fg }]} numberOfLines={2}>{b.title}</Text>
                            {b.subtitle ? <Text style={[s.bSub, { color: fg }]} numberOfLines={2}>{b.subtitle}</Text> : null}
                            <Pressable onPress={() => onOrder(b)} style={[s.bPill, { backgroundColor: fg }]}>
                                <Text style={[s.bPillTxt, { color: onColor(fg) }]}>Order now</Text>
                                <Ionicons name="arrow-forward" size={13} color={onColor(fg)} style={{ marginLeft: 4 }} />
                            </Pressable>
                        </View>
                    );
                }}
            />
            {list.length > 1 ? (
                <View style={s.dots}>
                    {list.map((b, i) => (
                        <View key={b._id} style={[s.pgDot, i === cur ? { width: 20, backgroundColor: primary } : { backgroundColor: border }]} />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

/* ---------------- offers: coupon tickets ---------------- */
function OfferTicket({ o, onPress }) {
    const { primary, onPrimary, text, muted, surface, border, background } = useBrand();
    const value = o.discountType === 'percent' ? `${o.discountValue}%` : `₹${o.discountValue}`;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [s.ticket, { backgroundColor: surface, borderColor: border }, pressed && { transform: [{ scale: 0.97 }] }]}>
            <View style={[s.tkLeft, { backgroundColor: primary }]}>
                <Text style={[s.tkVal, { color: onPrimary }]}>{value}</Text>
                <Text style={[s.tkOff, { color: onPrimary }]}>OFF</Text>
            </View>
            <View style={[s.notch, { top: -8, left: 56, backgroundColor: background }]} />
            <View style={[s.notch, { bottom: -8, left: 56, backgroundColor: background }]} />
            <View style={s.tkRight}>
                <View style={[s.codeBox, { borderColor: primary, backgroundColor: tint(primary) }]}>
                    <Text style={[s.offerCode, { color: primary }]}>{o.code}</Text>
                    <CopyIcon code={o.code} color={primary} style={{ marginLeft: 8 }} />
                </View>
                <Text style={[s.offerDesc, { color: text }]} numberOfLines={2}>
                    {o.description || (o.discountType === 'percent' ? `${o.discountValue}% off` : `₹${o.discountValue} off`)}
                </Text>
                {o.minOrder ? <Text style={[s.offerMin, { color: muted }]}>Min order ₹{o.minOrder}</Text> : null}
            </View>
        </Pressable>
    );
}

function OffersStrip({ list }) {
    const nav = useNavigation();
    const { primary, text } = useBrand();
    return (
        <View>
            <View style={s.secRow}>
                <Text style={[s.secTitle, { color: text }]}>Offers for you</Text>
                <Pressable onPress={() => nav.navigate('Offers')} style={s.seeRow}>
                    <Text style={[s.link, { color: primary }]}>See all</Text>
                    <Ionicons name="chevron-forward" size={14} color={primary} />
                </Pressable>
            </View>
            <FlatList
                horizontal data={list} showsHorizontalScrollIndicator={false}
                keyExtractor={(o) => o._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item: o }) => <OfferTicket o={o} onPress={() => nav.navigate('Offers')} />}
            />
        </View>
    );
}

function Chip({ label, on, onPress, badge, icon }) {
    const { primary, onPrimary, surface, border, text } = useBrand();
    const a = useRef(new Animated.Value(on ? 1 : 0)).current;
    const b = useRef(new Animated.Value(badge ? 1 : 0)).current;
    const p = useRef(new Animated.Value(1)).current;
    const [shown, setShown] = useState(badge);

    useEffect(() => {
        Animated.timing(a, { toValue: on ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [on]);
    useEffect(() => {
        if (badge) setShown(badge);                         // keep the old number while it shrinks away
        Animated.timing(b, { toValue: badge ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [badge]);

    const to = (v) => Animated.spring(p, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [surface, primary] });
    const bd = a.interpolate({ inputRange: [0, 1], outputRange: [border, primary] });
    const fg = a.interpolate({ inputRange: [0, 1], outputRange: [text, onPrimary] });

    return (
        <Animated.View style={{ transform: [{ scale: p }], marginRight: 8 }}>
            <Pressable onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)}>
                <Animated.View style={[s.chip, { marginRight: 0, backgroundColor: bg, borderColor: bd }]}>
                    {icon ? (
                        <View style={{ width: 14, height: 14, marginRight: 5 }}>
                            <Animated.View style={{ opacity: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
                                <Ionicons name={icon} size={14} color={text} />
                            </Animated.View>
                            <Animated.View style={[StyleSheet.absoluteFill, { opacity: a }]}>
                                <Ionicons name={icon} size={14} color={onPrimary} />
                            </Animated.View>
                        </View>
                    ) : null}
                    <Animated.Text style={[s.chipTxt, { color: fg }]}>{label}</Animated.Text>
                    {shown ? (
                        <Animated.View style={[s.chipBadge, {
                            minWidth: 0, paddingHorizontal: 0, overflow: 'hidden',
                            backgroundColor: primary, opacity: b,
                            width: b.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }),
                            marginLeft: b.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }),
                            transform: [{ scale: b }],
                        }]}>
                            <Text style={[s.cBadgeTxt, { color: onPrimary }]}>{shown}</Text>
                        </Animated.View>
                    ) : null}
                </Animated.View>
            </Pressable>
        </Animated.View>
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
    if (!canOpen && !quick.length) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fl}>
            {canOpen ? <Chip icon="options-outline" label="Filters" on={false} badge={n} onPress={onOpen} /> : null}
            {quick.map((q) => <Chip key={q[0]} label={q[0]} on={q[1]} onPress={q[2]} />)}
        </ScrollView>
    );
}

/* ---------------- filters row, strips ---------------- */

function SecHead({ title, sub, see, onSee }) {
    const { primary, text, muted } = useBrand();
    return (
        <View style={s.secRow}>
            <View style={s.secLeft}>
                <View style={[s.secBar, { backgroundColor: primary }]} />
                <View style={{ flex: 1 }}>
                    <Text style={[s.secTitle, { color: text }]} numberOfLines={1}>{title}</Text>
                    {sub ? <Text style={[s.secSub, { color: muted }]}>{sub}</Text> : null}
                </View>
            </View>
            {see ? (
                <Pressable onPress={onSee} style={s.seeRow}>
                    <Text style={[s.link, { color: primary }]}>See all</Text>
                    <Ionicons name="chevron-forward" size={14} color={primary} />
                </Pressable>
            ) : null}
        </View>
    );
}

function Strip({ r }) {
    const nav = useNavigation();
    return (
        <View>
            <SecHead title={r.title} sub={r.sub} see={!!r.see} onSee={() => nav.navigate(r.see)} />
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
    const panel = useRef(null);
    const [barH, setBarH] = useState(72);
    const voice = useVoice((t) => nav.navigate('Search', { voice: t, n: Date.now() }));
    const openVoice = voice.start;

    useEffect(() => { useCartStore.getState().hydrate(); loadMenu(); }, []);
    useEffect(() => {
        if (user && full.features.favourites) useFavStore.getState().load();
        else useFavStore.getState().reset();
    }, [user, full.features.favourites]);

    useEffect(() => { useHomeStore.getState().loadOffers(); }, [user?.id || user?._id || null]);

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
    // The food list follows the filters one beat late, so it can fade out first, swap, then fade in.
    const snapOf = () => ({ categories: f.categories, active: f.active, sort: f.sort, price: f.price, spice: f.spice, serves: f.serves, weight: f.weight });
    const [applied, setApplied] = useState(snapOf);
    const fade = useRef(new Animated.Value(1)).current;
    const sig = JSON.stringify(snapOf());
    const firstSig = useRef(true);
    useEffect(() => {
        if (firstSig.current) { firstSig.current = false; return undefined; }
        let alive = true;
        const snap = snapOf();
        Animated.timing(fade, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
            if (!finished || !alive) return;
            setApplied(snap);                                   // swap while the list is invisible
            setTimeout(() => {
                if (!alive) return;
                Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
            }, 90);
        });
        return () => { alive = false; fade.stopAnimation(); };
    }, [sig]);

    const filtered = useMemo(
        () => applyFilters(all, applied, full.ratings.minCount),
        [all, applied, full.ratings.minCount],
    );
    const grouped = full.menu.groupByCategory;
    // strips hide at once on select, and come back only after the list has swapped
    const hide = f.categories.length > 0 || applied.categories.length > 0;
    const extra = useMemo(() => ({ brand, hide }), [brand, hide]);

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
                    const nm = chips.filter((c) => applied.categories.includes(String(c._id))).map((c) => c.name).join(', ');
                    R.push({ t: 'sec', title: nm || 'Full menu', sub: `${filtered.length} dishes` });
                    pushItems(filtered);
                }
            }
        }
        return R;
    }, [config, full, banners, chips, offers, recommended, festival, combo, all, filtered, grouped, menuCats, loaded, errorStatus, applied.categories]);

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

            const first = R[idxs[0]];
            const second = R[idxs[1]];

            // Prioritize a new category header (sec) if it's in the top 2 visible items.
            // This makes the tag update immediately when a new category scrolls in,
            // instead of waiting for the old category to completely leave the screen.
            if (first && first.t === 'sec') {
                sec = first.cat;
            } else if (second && second.t === 'sec') {
                sec = second.cat;
            } else if (first && first.cat) {
                sec = first.cat;
            }
        }
        panel.current?.set(cats, sec);
    }).current;

    const onOrder = (b) => {
        if (b.couponCode) nav.navigate('Offers');
        else if (menuIdx >= 0) listRef.current?.scrollToIndex({ index: menuIdx, animated: true });
    };

    const renderBase = ({ item: r }) => {
        switch (r.t) {
            case 'header': return <Header />;
            case 'search': return <StickyBar names={names} onHeight={setBarH} onMic={openVoice} />;
            case 'closed': return (
                <View style={s.closed}>
                    <Ionicons name="moon-outline" size={15} color="#B3261E" />
                    <Text style={s.closedTxt}>{closedText(full)}</Text>
                </View>
            );
            case 'banner': return <Banners list={banners} onOrder={onOrder} />;
            case 'cats': return <Cats />;
            case 'filters': return <FiltersRow onOpen={() => setDlg(true)} />;
            case 'offers': return <FadeCollapse hide={hide}><OffersStrip list={offers} /></FadeCollapse>;
            case 'strip': return <FadeCollapse hide={hide}><Strip r={r} /></FadeCollapse>;
            case 'sec': return <SecHead title={r.title} sub={r.sub} />;
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
                    <Ionicons name="cloud-offline-outline" size={34} color={brand.muted} />
                    <Text style={[s.emptyTxt, { color: brand.muted }]}>Could not load the menu</Text>
                    <Pressable onPress={loadMenu}><Text style={[s.link, { color: brand.primary, marginTop: 10 }]}>Try again</Text></Pressable>
                </View>
            );
            case 'empty': return (
                <View style={s.empty}>
                    <Ionicons name="restaurant-outline" size={34} color={brand.muted} />
                    <Text style={[s.emptyTxt, { color: brand.muted }]}>{full.labels.emptySearch}</Text>
                </View>
            );
            default: return null;
        }
    };

    const FADE_ROWS = ['sec', 'item', 'pair', 'empty'];
    const renderRow = (info) => {
        const node = renderBase(info);
        if (!FADE_ROWS.includes(info.item.t)) return node;
        return (
            <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
                {node}
            </Animated.View>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: brand.background }}>
            {/* the status bar area takes the header's top colour so the header flows into it */}
            <View style={{ height: insets.top, backgroundColor: brand.primaryLight }} />
            <FlashList
                ref={listRef}
                data={rows}
                renderItem={renderRow}
                keyExtractor={(r, i) => (r.item ? `i${r.item._id}` : r.a ? `p${r.a._id}` : r.id ? `s${r.id}` : `${r.t}${r.title || ''}${r.t === 'sec' ? '' : i}`)}
                getItemType={(r) => r.t}
                stickyHeaderIndices={searchIdx >= 0 ? [searchIdx] : undefined}
                extraData={extra}
                onViewableItemsChanged={onViewable}
                viewabilityConfig={VIEW_CFG}
                refreshing={refreshing}
                onRefresh={refresh}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 100 }}
            />
            {searchIdx >= 0 ? <StuckPanel ref={panel} top={insets.top + barH} grouped={grouped} /> : null}
            <CartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
            <VoiceOverlay on={voice.on} txt={voice.txt} onStop={voice.stop} />
        </View>
    );
}

const s = StyleSheet.create({
    hd: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
    hdRow: { flexDirection: 'row', alignItems: 'center' },
    logo: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
    logoImg: { width: 50, height: 50 },
    logoTxt: { fontSize: 22, fontWeight: '900' },
    hdName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
    hdTag: { fontSize: 12, opacity: 0.88, marginTop: 1 },
    ic: { width: 40, height: 40, borderRadius: 20, backgroundColor: glass, alignItems: 'center', justifyContent: 'center' },
    cBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    cBadgeTxt: { fontSize: 10, fontWeight: '800' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
    hChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: glass, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6, marginRight: 8, marginBottom: 4 },
    hChipTxt: { fontSize: 12, fontWeight: '700' },
    statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },

    sticky: { paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, elevation: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    sb: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 48, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
    ph: { flex: 1, height: 20, lineHeight: 20, fontSize: 14, marginLeft: 10 },
    stuckSec: { fontSize: 13, fontWeight: '800', paddingHorizontal: 16, paddingTop: 4 },
    phBox: { flex: 1, height: 20, marginLeft: 10, overflow: 'hidden' },
    phTxt: { height: 20, lineHeight: 20, fontSize: 14 },
    phAbs: { position: 'absolute', left: 0, right: 0, top: 0 },
    vegWrap: { alignItems: 'center', marginLeft: 12 },
    vegTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 3 },
    vTrack: { width: 40, height: 22, borderRadius: 11 },
    vKnob: { position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 1 },
    vMark: { width: 11, height: 11, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
    vMarkDot: { width: 5, height: 5, borderRadius: 2.5 },
    panelWrap: { position: 'absolute', left: 0, right: 0, overflow: 'hidden', zIndex: 5 },

    cats: { paddingHorizontal: 16, paddingVertical: 12 },
    cat: { width: 78, alignItems: 'center', marginRight: 6 },
    catRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
    catCircle: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    catImg: { width: 62, height: 62 },
    catName: { marginTop: 5, fontSize: 12 },

    closed: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FDECEA', marginHorizontal: 16, marginTop: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    closedTxt: { color: '#B3261E', fontWeight: '700', fontSize: 12, marginLeft: 8, flex: 1 },

    hpad: { paddingHorizontal: 16, paddingVertical: 8 },
    banner: { height: 170, borderRadius: 24, overflow: 'hidden', padding: 20, justifyContent: 'center' },
    bTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, maxWidth: '72%', lineHeight: 29 },
    bSub: { fontSize: 13, marginTop: 5, maxWidth: '70%', opacity: 0.92 },
    bPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 14, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8 },
    bPillTxt: { fontSize: 13, fontWeight: '800' },
    dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4, marginBottom: 2 },
    pgDot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 3 },

    secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
    secLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    secBar: { width: 4, height: 28, borderRadius: 2, marginRight: 10 },
    secTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
    secSub: { fontSize: 12, marginTop: 1 },
    seeRow: { flexDirection: 'row', alignItems: 'center' },
    link: { fontSize: 13, fontWeight: '800' },

    ticket: { width: 262, height: 92, flexDirection: 'row', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    tkLeft: { width: 64, borderTopLeftRadius: 16, borderBottomLeftRadius: 16, alignItems: 'center', justifyContent: 'center' },
    tkVal: { fontSize: 18, fontWeight: '900' },
    tkOff: { fontSize: 11, fontWeight: '800', marginTop: 1, opacity: 0.9 },
    notch: { position: 'absolute', width: 16, height: 16, borderRadius: 8 },
    tkRight: { flex: 1, paddingHorizontal: 14, justifyContent: 'center' },
    codeBox: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    offerCode: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },
    offerDesc: { fontSize: 12, fontWeight: '600', marginTop: 5 },
    offerMin: { fontSize: 11, marginTop: 2 },

    fl: { paddingHorizontal: 16, paddingVertical: 10 },
    chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 20, marginRight: 8 },
    chipTxt: { fontSize: 13, fontWeight: '700', textAlign: 'center', includeFontPadding: false },
    chipBadge: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, marginLeft: 6, alignItems: 'center', justifyContent: 'center' },

    pair: { flexDirection: 'row', paddingHorizontal: 10 },
    empty: { padding: 40, alignItems: 'center' },
    emptyTxt: { fontSize: 14, marginTop: 8 },
});