// The Home page of the DESKTOP website (a browser at least 1024 px wide). The phone, the phone browser and tablets keep HomeScreen exactly as it is:
// HomeScreen picks this one only on a wide web window (utils/common/layout.js useCustomerDesktop).
//
//   [ shop name, tagline, info pills ]   [ the shop's banner, with dots ]
//   [ VISIT US  address ........................................ (->) ]
//   [ category ][ category ][ category ][ category ]      (4 across, wider than tall)
//   offers, bestsellers, combos, then the dishes, section by section
// The Delivery | Pickup | Dine in switch, the search, the address and the cart live in the top bar (DesktopTopBar).
//
// It is built from what the shop has switched on, and every part closes up when it is off or empty:
//   - no banner (or the banner block is off): the title takes the full width; one banner: no dots
//   - "Visit us" only when the shop has an address and Directions is on
//   - the info pills (open now, minutes, delivery fee, minimum order) follow the shop's switches
//   - the categories fill from the left, so 2 categories or 20 both look right; offers, bestsellers, combos... appear only when they have something to show
//   - the dish sections follow the shop's grouping setting
// Colours come from the shop's own theme (useBrand), so a dark shop looks dark and every shop wears its own colour.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, onColor } from '../../components/common/kit';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useMenuStore, useCartStore, useFavStore } from '../../store/customers/shopStores';
import { useFilterStore, applyFilters } from '../../store/customers/useFilterStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { useOrderMode, modesOf } from '../../store/customers/useOrderMode';
import { useStoreSpot, openDirections } from '../../components/customers/storeLocation';
import { ItemCard, useClosedStyle, closedText } from '../../components/customers/shop';
import { CouponTicket } from '../../components/customers/coupon';
import { FiltersRow } from '../../components/customers/finder';
import { SkelFeed } from '../../components/customers/skeletons';
import BranchChip from '../../components/customers/BranchChip';
import BulkCartBar from '../../components/customers/BulkCartBar';
import DineBusyNote from '../../components/customers/DineBusyNote';
import DineHomeCard from '../../components/customers/DineHomeCard';
import FilterDialog from './FilterDialog';
import { DESKTOP_PAGE_MAX } from '../../utils/common/layout';
import { tr } from '../../i18n';

const GAP = 16;
const CARD_MIN = 215;   // a dish card is about as wide as on a phone: more columns, never huge cards

/* one row of equal cells per `cols` items; a short last row keeps the cell width (no stretched card) */
function Grid({ items, cols, render, gap = GAP }) {
    const c = Math.max(1, cols);
    const rows = [];
    for (let i = 0; i < items.length; i += c) rows.push(items.slice(i, i + c));
    return (
        <View style={{ gap }}>
            {rows.map((r, ri) => (
                <View key={ri} style={{ flexDirection: 'row', gap }}>
                    {Array.from({ length: c }).map((_, i) => <View key={i} style={{ flex: 1 }}>{r[i] ? render(r[i]) : null}</View>)}
                </View>
            ))}
        </View>
    );
}

function SecHead({ title, sub, onSee }) {
    const { primary, text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 4, height: sub ? 32 : 22, borderRadius: 2, backgroundColor: primary, marginRight: 12 }} />
            <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: text, fontSize: 20, fontWeight: '900' }}>{title}</Text>
                {sub ? <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{sub}</Text> : null}
            </View>
            {onSee ? (
                <Pressable onPress={onSee} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', opacity: hovered ? 0.7 : 1, cursor: 'pointer' })}>
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>{tr('See all')}</Text>
                    <Ionicons name="chevron-forward" size={15} color={primary} />
                </Pressable>
            ) : null}
        </View>
    );
}

/* ---------------- the shop, and its banner beside it ---------------- */
function Pill({ icon, dot, text }) {
    const { surface, border, text: fg } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: surface, borderWidth: 1, borderColor: border, marginRight: 8, marginBottom: 8 }}>
            {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot, marginRight: 7 }} /> : null}
            {icon ? <Ionicons name={icon} size={14} color={fg} style={{ marginRight: 6 }} /> : null}
            <Text style={{ color: fg, fontSize: 12.5, fontWeight: '700' }}>{text}</Text>
        </View>
    );
}

function Header({ mode, hero }) {
    const { text, muted } = useBrand();
    const theme = useThemeStore((s) => s.theme);
    const full = useHomeStore((s) => s.full);
    const compact = theme.headerStyle === 'compact';
    const open = full.restaurant.isOpen;
    const mins = full.orders.prepTimeMin;
    const fee = full.orders.deliveryFee || {};
    const delivers = (full.orders.types || []).includes('delivery');

    const pills = [];
    if (full.features.prepTime && mins) pills.push({ icon: 'time-outline', text: tr('{n} min', { n: mins }) });
    if (delivers && mode === 'delivery') {
        if (fee.type === 'free' || !fee.amount) pills.push({ icon: 'bicycle-outline', text: tr('Free delivery') });
        else if (fee.freeAbove > 0) pills.push({ icon: 'bicycle-outline', text: tr('Free above ₹{n}', { n: fee.freeAbove }) });
        else pills.push({ icon: 'bicycle-outline', text: tr('₹{n} delivery', { n: fee.amount }) });
    }
    if (full.orders.minOrder > 0) pills.push({ icon: 'bag-check-outline', text: tr('Min ₹{n}', { n: full.orders.minOrder }) });

    const n = String(theme.name || '').length;
    const size = compact ? 26 : n <= 22 ? 40 : n <= 36 ? 36 : 30;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 22, paddingBottom: 18 }}>
            <View style={{ flex: hero ? 4 : 1, paddingRight: hero ? 32 : 0 }}>
                <Text style={{ color: text, fontSize: size, lineHeight: Math.round(size * 1.16), fontWeight: '900', letterSpacing: -0.5 }}>{theme.name}</Text>
                {theme.tagline && !compact ? <Text style={{ color: muted, fontSize: 15, lineHeight: 22, marginTop: 8 }}>{tr(theme.tagline)}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 }}>
                    <Pill dot={open ? '#4ADE80' : '#FF6B6B'} text={open ? tr('Open now') : tr('Closed')} />
                    {pills.map((p) => <Pill key={p.text} icon={p.icon} text={p.text} />)}
                </View>
            </View>
            {hero ? <View style={{ flex: 6 }}>{hero}</View> : null}
        </View>
    );
}

function Hero({ list, onOrder }) {
    const { primary, primaryLight, primaryDark, border } = useBrand();
    const n = list.length;
    const [cur, setCur] = useState(0);
    useEffect(() => { if (cur >= n) setCur(0); }, [n, cur]);   // a banner was removed while it was showing
    useEffect(() => {   // auto-advance; restarts after every change so a click is never undone at once
        if (n < 2) return undefined;
        const t = setInterval(() => setCur((i) => (i + 1) % n), 5500);
        return () => clearInterval(t);
    }, [n, cur]);

    // A sideways two-finger swipe on the trackpad changes the slide (left = next, right = previous). One swipe moves ONE slide: the trackpad keeps
    // sending movement after the fingers lift, so the banner waits a moment before it listens again. Over the banner the browser's own "swipe to go
    // back / forward" is blocked (native listener, because the page's handler must be allowed to cancel the event), even when there is only one slide.
    const boxRef = useRef(null);
    useEffect(() => {
        const el = boxRef.current;
        if (!el || !el.addEventListener) return undefined;
        let acc = 0; let lockUntil = 0;
        const onWheel = (e) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // an up/down scroll is not a swipe: the page scrolls as usual
            e.preventDefault();
            if (n < 2) return;
            const now = Date.now();
            if (now < lockUntil) return;
            acc += e.deltaX;
            if (Math.abs(acc) < 50) return;
            setCur((i) => (acc > 0 ? (i + 1) % n : (i - 1 + n) % n));
            acc = 0; lockUntil = now + 700;
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [n]);

    const b = list[Math.min(cur, n - 1)];
    if (!b) return null;
    const hasImg = !!b.image;
    const fg = hasImg ? '#FFFFFF' : onColor(primaryLight);
    return (
        <View ref={boxRef} style={{ overscrollBehaviorX: 'none' }}>
            <View style={{ height: 250, borderRadius: 18, overflow: 'hidden', backgroundColor: primaryDark }}>
                {hasImg ? (
                    <>
                        <Image key={b._id || cur} source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={500} />
                        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.80)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.04)']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    </>
                ) : (
                    <LinearGradient pointerEvents="none" colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                )}
                <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32, maxWidth: '75%' }}>
                    <Text numberOfLines={2} style={{ color: fg, fontSize: 32, lineHeight: 38, fontWeight: '900', letterSpacing: -0.5 }}>{b.title}</Text>
                    {b.subtitle ? <Text numberOfLines={2} style={{ color: fg, opacity: 0.9, fontSize: 15, lineHeight: 21, marginTop: 8 }}>{b.subtitle}</Text> : null}
                    <Pressable
                        onPress={() => onOrder(b)}
                        style={({ hovered }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 20, borderRadius: 20, marginTop: 18, backgroundColor: fg, transform: [{ scale: hovered ? 1.05 : 1 }], cursor: 'pointer' })}
                    >
                        <Text style={{ color: onColor(fg), fontSize: 14, fontWeight: '900' }}>{tr('Order now')}</Text>
                        <Ionicons name="arrow-forward" size={15} color={onColor(fg)} style={{ marginLeft: 7 }} />
                    </Pressable>
                </View>
            </View>
            {n > 1 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12 }}>
                    {list.map((x, i) => (
                        <Pressable key={x._id || i} onPress={() => setCur(i)} hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }} style={{ marginHorizontal: 4, cursor: 'pointer' }} accessibilityLabel={`${i + 1}`}>
                            <View style={{ width: i === cur ? 24 : 7, height: 7, borderRadius: 4, backgroundColor: i === cur ? primary : border }} />
                        </Pressable>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

/* ---------------- visit us: one wide bar ---------------- */
function VisitBar() {
    const { primary, onPrimary, text, muted } = useBrand();
    const spot = useStoreSpot();
    if (!spot.on || (!spot.address && !spot.pinned)) return null;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, marginBottom: 18, borderWidth: 1, borderColor: `${primary}40`, overflow: 'hidden' }}>
            <LinearGradient pointerEvents="none" colors={[`${primary}2E`, `${primary}0F`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: `${primary}33`, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={spot.pinned ? 'storefront-outline' : 'location-outline'} size={20} color={primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: muted, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2 }}>{spot.pinned ? tr('VISIT US') : tr('FIND US')}</Text>
                <Text numberOfLines={2} style={{ color: text, fontSize: 15, fontWeight: '800', marginTop: 2 }}>{spot.address || tr('On the map')}</Text>
            </View>
            {spot.pinned ? (
                <Pressable
                    onPress={() => openDirections(spot)}
                    accessibilityRole="button"
                    accessibilityLabel={tr('Get directions')}
                    style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', transform: [{ scale: hovered ? 1.08 : 1 }], cursor: 'pointer' })}
                >
                    <Ionicons name="arrow-forward" size={19} color={onPrimary} />
                </Pressable>
            ) : null}
        </View>
    );
}

/* ---------------- categories: photo tiles, 4 across ---------------- */
// The tile itself never moves or changes size: only the photo inside it grows a little on hover (and brightens), and the tile's rounded edge
// clips it. Scaling the whole tile made its edge and its backing colour show as a thin border. The selected ring is a layer on top, so it
// never changes the tile's size either.
function CatTile({ c, on, onPress, w, h }) {
    const { primary, primaryLight, primaryDark, onPrimary } = useBrand();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', isolation: 'isolate', backgroundColor: '#111111' }}
        >
            {({ hovered }) => (
                <>
                    <View
                        pointerEvents="none"
                        style={[StyleSheet.absoluteFill, {
                            transform: [{ scale: hovered ? 1.09 : 1 }], filter: hovered ? 'brightness(1.12)' : 'brightness(1)',
                            transitionProperty: 'transform, filter', transitionDuration: '380ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.7, 0.2, 1)',
                        }]}
                    >
                        {c.image ? <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : (
                            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: 24 }]}>
                                <Text style={{ color: '#FFFFFF', fontSize: Math.round(h / 2.6), fontWeight: '900', opacity: 0.85 }}>{(c.name || '?')[0].toUpperCase()}</Text>
                            </LinearGradient>
                        )}
                    </View>
                    <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
                    <Text numberOfLines={2} style={{ position: 'absolute', left: 10, right: 10, bottom: 12, textAlign: 'center', color: '#FFFFFF', fontSize: 20, lineHeight: 24, fontWeight: '900' }}>{c.name}</Text>
                    {on ? (
                        <>
                            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 16, borderWidth: 3, borderColor: primary }]} />
                            <View style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="checkmark" size={14} color={onPrimary} />
                            </View>
                        </>
                    ) : null}
                </>
            )}
        </Pressable>
    );
}

function CategoryGrid({ chips, width, onPick }) {
    const sel = useFilterStore((s) => s.categories);
    const toggle = useFilterStore((s) => s.toggleCategory);
    const clear = useFilterStore((s) => s.clearCategories);
    const { primary } = useBrand();
    const cols = width >= 900 ? 4 : 3;   // a short list keeps the same tile size and fills from the left
    const w = Math.floor((Math.max(width, 320) - GAP * (cols - 1)) / cols);
    const h = Math.round(w / 1.4);
    return (
        <View style={{ marginBottom: 30 }}>
            {sel.length ? (
                <Pressable onPress={clear} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginBottom: 10, opacity: hovered ? 0.7 : 1, cursor: 'pointer' })}>
                    <Ionicons name="close-circle" size={17} color={primary} />
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 14, marginLeft: 5 }}>{tr('Clear all')}</Text>
                </Pressable>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                {chips.map((c) => {
                    const id = String(c._id);
                    return <CatTile key={id} c={c} w={w} h={h} on={sel.includes(id)} onPress={() => { toggle(id); onPick(); }} />;
                })}
            </View>
        </View>
    );
}

/* ---------------- the page ---------------- */
export default function HomeDesktop() {
    const nav = useNavigation();
    const brand = useBrand();
    const closedStyle = useClosedStyle();
    const user = useAuthStore((s) => s.user);
    const { config, full, categories: chips, banners, offers: allOffers } = useHomeStore();
    const { categories: menuCats, recommended, festival, combo, loaded, errorStatus, load: loadMenu } = useMenuStore();
    const f = useFilterStore();
    const [dlg, setDlg] = useState(false);
    const [colW, setColW] = useState(DESKTOP_PAGE_MAX - 48);   // measured below; this is only the first guess
    const menuRef = useRef(null);

    // the same loading the phone's Home does (it is not mounted on the desktop)
    useEffect(() => { useOrderMode.getState().load(); }, []);
    useFocusEffect(useCallback(() => { if (user) useAddressStore.getState().refresh(); }, [user?.id || user?._id || null]));   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!user) useAddressStore.getState().clear(); }, [user]);
    useEffect(() => { useCartStore.getState().hydrate(); loadMenu(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (user && full.features.favourites) useFavStore.getState().load();
        else useFavStore.getState().reset();
    }, [user, full.features.favourites]);
    useEffect(() => { useHomeStore.getState().loadOffers(); }, [user?.id || user?._id || null]);   // eslint-disable-line react-hooks/exhaustive-deps

    const modes = modesOf(full);
    const picked = useOrderMode((s) => s.mode);
    const mode = modes.length > 1 ? (modes.includes(picked) ? picked : modes[0]) : (modes[0] || 'delivery');
    const dineMode = mode === 'dine_in' && modes.includes('dine_in');
    const offers = useMemo(() => (dineMode ? allOffers : allOffers.filter((o) => !o.dineInOnly)), [allOffers, dineMode]);

    const all = useMemo(() => menuCats.flatMap((c) => c.items), [menuCats]);
    const filtered = useMemo(
        () => applyFilters(all, { categories: f.categories, active: f.active, sort: f.sort, price: f.price, spice: f.spice, serves: f.serves, weight: f.weight }, full.ratings.minCount),
        [all, f.categories, f.active, f.sort, f.price, f.spice, f.serves, f.weight, full.ratings.minCount],
    );
    const showStrips = f.categories.length === 0;
    const vegOnly = f.active.includes('veg_only');
    const keep = (list) => (vegOnly ? list.filter((p) => p.isVeg) : list);
    const waiting = !loaded && !errorStatus;
    const cols = Math.max(1, Math.min(5, Math.floor((colW + GAP) / (CARD_MIN + GAP))));
    const toMenu = () => { try { menuRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } catch (e) { /* stay */ } };
    const onOrder = (b) => { if (b.couponCode) nav.navigate('Offers'); else toMenu(); };

    // the banner sits beside the title; it is there only when the shop's banner block is on and it has banners (or they are still loading)
    const bannerOn = (config.blocks || []).includes('banner');
    const hero = bannerOn && banners.length ? <Hero list={banners} onOrder={onOrder} />
        : bannerOn && waiting ? <View style={{ height: 250, borderRadius: 18, backgroundColor: brand.surface }} /> : null;

    const card = (item) => <ItemCard key={item._id} item={item} variant="desk" />;
    const blocks = [];
    for (const b of config.blocks || []) {
        if (b === 'categories' && chips.length) {
            blocks.push(<CategoryGrid key="cats" chips={chips} width={colW} onPick={toMenu} />);
        } else if (b === 'filters') {
            blocks.push(<View key="filters" style={{ marginBottom: 18, marginHorizontal: -16 }}><FiltersRow onOpen={() => setDlg(true)} /></View>);   // the row has 16 px of its own padding: pull it back onto the grid's edge
        } else if (b === 'offers' && showStrips && offers.length && full.offers.couponsEnabled && full.offers.showOnHome) {
            const oc = Math.max(1, Math.min(3, Math.floor((colW + GAP) / (330 + GAP))));
            blocks.push(
                <View key="offers" style={{ marginBottom: 30 }}>
                    <SecHead title={tr('Offers for you')} onSee={() => nav.navigate('Offers')} />
                    <Grid items={offers.slice(0, oc * 2)} cols={oc} render={(o) => <CouponTicket key={o._id} o={o} size="full" onPress={() => nav.navigate('Offers')} />} />
                </View>,
            );
        } else if (!showStrips && ['bestsellers', 'festival', 'combos', 'new_arrivals'].includes(b)) {
            continue;
        } else if (b === 'bestsellers' && keep(recommended).length) {
            blocks.push(<Strip key="best" title={tr('Bestsellers')} sub={tr('Most ordered')} items={keep(recommended)} cols={cols} render={card} onSee={() => nav.navigate('Bestsellers')} />);
        } else if (b === 'festival') {
            festival.forEach((c) => { const items = keep(c.products); if (items.length) blocks.push(<Strip key={`f${c.id}`} title={c.title} sub={c.subtitle || ''} items={items} cols={cols} render={card} />); });
        } else if (b === 'combos') {
            combo.forEach((c) => { const items = keep(c.products); if (items.length) blocks.push(<Strip key={`c${c.id}`} title={c.title} sub={c.subtitle || ''} items={items} cols={cols} render={card} />); });
        } else if (b === 'new_arrivals') {
            const news = keep(all.filter((i) => i.isNewArrival)).slice(0, 10);
            if (news.length) blocks.push(<Strip key="new" title={tr('New arrivals')} sub={tr('Just added')} items={news} cols={cols} render={card} />);
        } else if (b === 'items') {
            blocks.push(
                <View key="items" ref={menuRef}>
                    {!loaded ? <SkelFeed variant="grid" count={cols * 2} />
                        : !all.length && errorStatus ? (
                            <Notice icon="cloud-offline-outline" text={tr('Could not load the menu')} action={tr('Try again')} onAction={loadMenu} />
                        ) : !filtered.length ? <Notice icon="restaurant-outline" text={tr(full.labels.emptySearch)} />
                            : full.menu.groupByCategory ? (() => {
                                const by = new Map();
                                filtered.forEach((p) => { const k = String(p.categoryId); if (!by.has(k)) by.set(k, []); by.get(k).push(p); });
                                return menuCats.map((c) => {
                                    const A = by.get(String(c._id));
                                    if (!A?.length) return null;
                                    return <Strip key={c._id} title={c.name} sub={tr('{n} items', { n: A.length })} items={A} cols={cols} render={card} all />;
                                });
                            })() : (
                                <Strip
                                    title={chips.filter((c) => f.categories.includes(String(c._id))).map((c) => c.name).join(', ') || tr('Full menu')}
                                    sub={tr('{n} dishes', { n: filtered.length })} items={filtered} cols={cols} render={card} all
                                />
                            )}
                </View>,
            );
        }
    }

    return (
        <View style={[{ flex: 1, backgroundColor: brand.background }, closedStyle]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
                <View style={{ width: '100%', maxWidth: DESKTOP_PAGE_MAX, alignSelf: 'center', paddingHorizontal: 24 }}>
                    <View onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w && Math.abs(w - colW) > 1) setColW(w); }}>
                        <Header mode={mode} hero={hero} />
                        {full.restaurant.isOpen ? null : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: brand.errorSoft, marginBottom: 18 }}>
                                <Ionicons name="moon-outline" size={17} color={brand.errorText} />
                                <Text style={{ color: brand.errorText, fontWeight: '700', fontSize: 14.5, marginLeft: 10 }}>{closedText(full)}</Text>
                            </View>
                        )}
                        <VisitBar />
                        <BranchChip />
                        {dineMode ? <View style={{ marginBottom: 24 }}><DineBusyNote /><DineHomeCard /></View> : null}
                        {blocks}
                    </View>
                </View>
            </ScrollView>
            <BulkCartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
        </View>
    );
}

// a titled grid of dishes, shown up to two rows unless it is the whole menu (`all`)
function Strip({ title, sub, items, cols, render, onSee, all = false }) {
    const shown = all ? items : items.slice(0, cols * 2);
    return (
        <View style={{ marginBottom: 30 }}>
            <SecHead title={title} sub={sub} onSee={onSee} />
            <Grid items={shown} cols={cols} render={render} />
        </View>
    );
}

function Notice({ icon, text, action, onAction }) {
    const { muted, primary } = useBrand();
    return (
        <View style={{ alignItems: 'center', padding: 48 }}>
            <Ionicons name={icon} size={38} color={muted} />
            <Text style={{ color: muted, fontSize: 16, marginTop: 12 }}>{text}</Text>
            {action ? <Pressable onPress={onAction} style={{ marginTop: 12, cursor: 'pointer' }}><Text style={{ color: primary, fontWeight: '800' }}>{action}</Text></Pressable> : null}
        </View>
    );
}
