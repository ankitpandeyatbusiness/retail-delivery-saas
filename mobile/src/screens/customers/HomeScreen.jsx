// src/screens/HomeScreen.jsx
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { AddressSheet } from '../../components/customers/addresses';
import { useAddressStore } from '../../store/customers/useAddressStore';
import {
    View, Text, Pressable, FlatList, ScrollView, Animated, Easing, StatusBar, StyleSheet, useWindowDimensions, InteractionManager,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, mix, onColor } from '../../components/common/kit';
import { FadeIn, useMotion } from '../../components/common/motion';
import { SkelBanner, SkelFeed } from '../../components/customers/skeletons';
import { CouponTicket } from '../../components/customers/coupon';
import { StoreLocation } from '../../components/customers/storeLocation';
import { ItemCard, Tile, CartBar, useClosedStyle, closedText, showToast, tint } from '../../components/customers/shop';
import FilterDialog from './FilterDialog';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { useMenuStore, useCartStore, useFavStore } from '../../store/customers/shopStores';
import { useFilterStore, applyFilters, countActive } from '../../store/customers/useFilterStore';
import { Slider, VegSwitch, Cats, Collapse, useVoice, VoiceOverlay } from '../../components/customers/finder';
import { tr } from '../../i18n';
import { useBottomSpace } from '../../store/customers/useLiveTripStore';

const Gap = () => <View style={{ width: 12 }} />;
const VIEW_CFG = { itemVisiblePercentThreshold: 1 };
const glass = 'rgba(255,255,255,0.18)';

/* ---------------- storefront header (scrolls away) ---------------- */
// bold look: the brand-gradient header. Other looks: a light header on the canvas with a soft wash of the brand colour.
// The shop name, tagline and chips drift down and fade as the page scrolls (parallax), so the header melts away.
function Header({ onAddress, scrollY }) {
    const nav = useNavigation();
    const { primary, primaryLight, primaryDark, onPrimary, look, text, background, surface, border, wash } = useBrand();
    const theme = useThemeStore((st) => st.theme);
    const full = useHomeStore((st) => st.full);
    const motion = useMotion();

    const light = look !== 'bold';
    const compact = theme.headerStyle === 'compact';
    const fg = light ? text : onPrimary;
    const glassBg = light ? surface : glass;
    const glassLine = light ? border : 'rgba(255,255,255,0.28)';
    const colors = light ? [wash, background] : [primaryLight, primaryDark];

    const open = full.restaurant.isOpen;
    const mins = full.orders.prepTimeMin;
    const fee = full.orders.deliveryFee || {};
    const delivers = (full.orders.types || []).includes('delivery');
    const user = useAuthStore((st) => st.user);
    const unread = useNotificationStore((st) => st.unread);
    const addr = useAddressStore((st) => st.selected);
    const short = addr ? [addr.line1, addr.line2 || addr.city].filter(Boolean).join(', ') : '';

    const chips = [];
    if (full.features.prepTime && mins) chips.push({ icon: 'time-outline', text: `${mins} min` });
    if (delivers) {
        if (fee.type === 'free' || !fee.amount) chips.push({ icon: 'bicycle-outline', text: 'Free delivery' });
        else if (fee.freeAbove > 0) chips.push({ icon: 'bicycle-outline', text: `Free above ₹${fee.freeAbove}` });
        else chips.push({ icon: 'bicycle-outline', text: `₹${fee.amount} delivery` });
    }
    if (full.orders.minOrder > 0) chips.push({ icon: 'bag-check-outline', text: `Min ₹${full.orders.minOrder}` });
    const shownChips = compact ? chips.slice(0, 1) : chips;

    const drift = motion === 'full' && scrollY ? {
        opacity: scrollY.interpolate({ inputRange: [0, 170], outputRange: [1, 0.1], extrapolate: 'clamp' }),
        transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 240], outputRange: [0, 64], extrapolate: 'clamp' }) }],
    } : null;

    return (
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hd, compact && s.hdCompact, light && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            {light ? null : (
                <>
                    <View style={[s.blob, { top: -50, right: -40, width: 170, height: 170 }]} />
                    <View style={[s.blob, { bottom: -60, left: -30, width: 130, height: 130 }]} />
                </>
            )}
            {/* top line: where to deliver (or a welcome), and the quick actions */}
            <View style={s.hdTop}>
                {user ? (
                    <Pressable onPress={onAddress} hitSlop={8} style={s.locBlock}>
                        <Text style={[s.locCap, { color: fg }]}>{tr('DELIVER TO')}</Text>
                        <View style={s.locRow}>
                            <Ionicons name="location-sharp" size={16} color={light ? primary : fg} />
                            <Text style={[s.locTxt, { color: fg }]} numberOfLines={1}>
                                {addr ? <Text style={s.locLabel}>{addr.label}  </Text> : null}
                                {addr ? short : tr('Select delivery address')}
                            </Text>
                            <Ionicons name="chevron-down" size={15} color={fg} />
                        </View>
                    </Pressable>
                ) : (
                    <View style={s.locBlock}>
                        <Text style={[s.locCap, { color: fg }]}>{tr('WELCOME TO')}</Text>
                    </View>
                )}
                {user ? (
                    <Pressable onPress={() => nav.navigate('Notifications')} style={[s.ic, { backgroundColor: glassBg, marginRight: full.offers.couponsEnabled ? 8 : 0 }, light && { borderWidth: StyleSheet.hairlineWidth, borderColor: border }]} hitSlop={6}>
                        <Ionicons name="notifications-outline" size={20} color={fg} />
                        {unread > 0 ? (
                            <View style={s.bellBadge}><Text style={s.bellBadgeTxt}>{unread > 9 ? '9+' : unread}</Text></View>
                        ) : null}
                    </Pressable>
                ) : null}
                {full.offers.couponsEnabled ? (
                    <Pressable onPress={() => nav.navigate('Offers')} style={[s.ic, { backgroundColor: glassBg }, light && { borderWidth: StyleSheet.hairlineWidth, borderColor: border }]} hitSlop={6}>
                        <Ionicons name="pricetags-outline" size={20} color={fg} />
                    </Pressable>
                ) : null}
            </View>

            {/* the shop is the hero */}
            <Animated.View style={drift}>
                <Text style={[s.hdTitle, compact && s.hdTitleCompact, { color: fg }]} numberOfLines={1}>{theme.name}</Text>
                {theme.tagline && !compact ? <Text style={[s.hdTagline, { color: fg }]} numberOfLines={1}>{theme.tagline}</Text> : null}

                <View style={[s.chipRow, compact && { marginTop: 10 }]}>
                    <View style={[s.hChip, { backgroundColor: glassBg, borderColor: glassLine }]}>
                        <View style={[s.statusDot, { backgroundColor: open ? '#4ADE80' : '#FF6B6B' }]} />
                        <Text style={[s.hChipTxt, { color: fg }]}>{open ? tr('Open now') : tr('Closed')}</Text>
                    </View>
                    {shownChips.map((c) => (
                        <View key={c.text} style={[s.hChip, { backgroundColor: glassBg, borderColor: glassLine }]}>
                            <Ionicons name={c.icon} size={13} color={fg} />
                            <Text style={[s.hChipTxt, { color: fg, marginLeft: 4 }]}>{c.text}</Text>
                        </View>
                    ))}
                </View>
            </Animated.View>
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
const StuckPanel = forwardRef(function StuckPanel({ top, grouped, onHeight }, ref) {
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
            <Animated.View onLayout={(e) => onHeight?.(Math.round(e.nativeEvent.layout.height))} style={{ backgroundColor: background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border, opacity: a, transform: [{ translateY: ty }] }}>
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
    const motion = useMotion();
    const sx = useRef(new Animated.Value(0)).current;   // scroll position, on the UI thread: the cards beside the active one shrink a little

    const grads = [
        [primaryLight, primaryDark],
        [primaryDark, mix(primaryDark, '#000000', 0.5)],
        [mix(primary, '#000000', 0.2), mix(primaryLight, '#FFFFFF', 0.25)],
    ];

    // One way only: the banners slide forward, and after the last one the first comes in from the right again (never a slide
    // back). For that the list is drawn three times in a row and we live in the middle copy; when the slide ends in another
    // copy, the strip is moved by one whole copy without animation, which the eye cannot see.
    const n = list.length;
    const loop = n > 1;
    const data = useMemo(() => (loop ? [...list, ...list, ...list] : list), [list, loop]);
    const home = (i) => { idx.current = i; ref.current?.scrollToOffset({ offset: i * snap, animated: false }); };
    const settle = (i) => {   // i = the position the strip stopped at
        if (!loop) return;
        let k = i;
        if (k >= 2 * n) k -= n; else if (k < n) k += n;
        if (k !== i) home(k); else idx.current = i;
        setCur(k % n);
    };
    useEffect(() => { if (loop) { const t = setTimeout(() => home(n), 0); return () => clearTimeout(t); } return undefined; }, [n, snap]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!loop) return undefined;
        const t = setInterval(() => {
            const next = idx.current + 1;
            idx.current = next;
            ref.current?.scrollToOffset({ offset: next * snap, animated: true });
            setCur(next % n);
            setTimeout(() => settle(next), 650);   // after the slide: back into the middle copy
        }, 4500);
        return () => clearInterval(t);
    }, [n, snap]);   // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <View>
            <Animated.FlatList
                ref={ref}
                data={data} horizontal showsHorizontalScrollIndicator={false}
                getItemLayout={(_, i) => ({ length: w, offset: i * snap, index: i })}
                snapToInterval={snap} decelerationRate="fast" disableIntervalMomentum
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: sx } } }], { useNativeDriver: true })}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
                    if (loop) settle(i); else { idx.current = i; setCur(i); }
                }}
                keyExtractor={(b, i) => `${b._id}-${i}`} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item: b, index }) => {
                    const g = grads[(loop ? index % n : index) % 3];
                    const fg = b.image ? '#FFFFFF' : onColor(g[0]);
                    const scale = motion === 'full' && list.length > 1
                        ? sx.interpolate({ inputRange: [(index - 1) * snap, index * snap, (index + 1) * snap], outputRange: [0.93, 1, 0.93], extrapolate: 'clamp' })
                        : 1;
                    return (
                        <Animated.View style={[s.banner, { width: w, transform: [{ scale }] }]}>
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
                                <Text style={[s.bPillTxt, { color: onColor(fg) }]}>{tr('Order now')}</Text>
                                <Ionicons name="arrow-forward" size={13} color={onColor(fg)} style={{ marginLeft: 4 }} />
                            </Pressable>
                        </Animated.View>
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

/* ---------------- offers: coupon tickets (shared design: components/customers/coupon.jsx) ---------------- */
function OffersStrip({ list }) {
    const nav = useNavigation();
    const { primary, text } = useBrand();
    return (
        <View>
            <View style={s.secRow}>
                <Text style={[s.secTitle, { color: text }]}>{tr('Offers for you')}</Text>
                <Pressable onPress={() => nav.navigate('Offers')} style={s.seeRow}>
                    <Text style={[s.link, { color: primary }]}>{tr('See all')}</Text>
                    <Ionicons name="chevron-forward" size={14} color={primary} />
                </Pressable>
            </View>
            <FlatList
                horizontal data={list} showsHorizontalScrollIndicator={false}
                keyExtractor={(o) => o._id} contentContainerStyle={s.hpad} ItemSeparatorComponent={Gap}
                renderItem={({ item: o }) => <CouponTicket o={o} size="strip" onPress={() => nav.navigate('Offers')} />}
            />
        </View>
    );
}

function Chip({ label, on, onPress, badge, icon }) {
    const { primary, onPrimary, surface, border, text } = useBrand();
    const a = useRef(new Animated.Value(on ? 1 : 0)).current;
    const b = useRef(new Animated.Value(badge ? 1 : 0)).current;
    const [shown, setShown] = useState(badge);

    useEffect(() => {
        Animated.timing(a, { toValue: on ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [on]);
    useEffect(() => {
        if (badge) setShown(badge);                         // keep the old number while it shrinks away
        Animated.timing(b, { toValue: badge ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [badge]);

    const bg = a.interpolate({ inputRange: [0, 1], outputRange: [surface, primary] });
    const bd = a.interpolate({ inputRange: [0, 1], outputRange: [border, primary] });
    const fg = a.interpolate({ inputRange: [0, 1], outputRange: [text, onPrimary] });

    // no press-down squeeze: the chip just fades to its new colour, so tapping feels instant and calm
    return (
        <Animated.View style={{ marginRight: 8 }}>
            <Pressable onPress={onPress}>
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
                    {/* active chips can be switched off right here: a small x opens up beside the label */}
                    <Animated.View style={{ width: a.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }), marginLeft: a.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }), opacity: a, overflow: 'hidden' }}>
                        <Ionicons name="close" size={14} color={onPrimary} />
                    </Animated.View>
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
            {canOpen ? <Chip icon="options-outline" label={tr('Filters')} on={false} badge={n} onPress={onOpen} /> : null}
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
                    <Text style={[s.link, { color: primary }]}>{tr('See all')}</Text>
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
    const space = useBottomSpace();   // room for the floating order bar, only while it is on screen
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const brand = useBrand();
    const closedStyle = useClosedStyle();   // the shop is closed: this whole screen turns grey
    const user = useAuthStore((st) => st.user);
    const { config, full, categories: chips, banners, offers } = useHomeStore();
    const { categories: menuCats, recommended, festival, combo, loaded, errorStatus, load: loadMenu } = useMenuStore();
    const f = useFilterStore();
    const listRef = useRef(null);
    const [dlg, setDlg] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const panel = useRef(null);
    const scrollY = useRef(new Animated.Value(0)).current;   // pushed to the native node: the header drifts with the scroll
    const [barH, setBarH] = useState(72);
    const voice = useVoice((t) => nav.navigate('Search', { voice: t, n: Date.now() }));
    const openVoice = voice.start;
    const [addrOpen, setAddrOpen] = useState(false);
    const selectedAddr = useAddressStore((st) => st.selected);

    useFocusEffect(useCallback(() => {
        if (user) useAddressStore.getState().refresh();
    }, [user?.id || user?._id || null]));
    useEffect(() => { if (!user) useAddressStore.getState().clear(); }, [user]);

    useEffect(() => { useCartStore.getState().hydrate(); loadMenu(); }, []);
    useEffect(() => {
        if (user && full.features.favourites) useFavStore.getState().load();
        else useFavStore.getState().reset();
    }, [user, full.features.favourites]);

    useEffect(() => { useHomeStore.getState().loadOffers(); }, [user?.id || user?._id || null]);

    const refresh = async () => {
        setRefreshing(true);
        // pull to refresh = start fresh: every filter, the VEG switch, the sort and the selected categories go
        // back to default (the list change plays through the same smooth transition as any other change)
        useFilterStore.setState({ categories: [], active: [], sort: null, price: 0, spice: null, serves: null, weight: null });
        await Promise.all([useHomeStore.getState().load(), loadMenu()]);
        setRefreshing(false);
    };

    const all = useMemo(() => menuCats.flatMap((c) => c.items), [menuCats]);
    const vegNow = f.active.includes('veg_only');
    const names = useMemo(
        () => (vegNow ? all.filter((i) => i.isVeg) : [...all]).sort((a, b) => (b.isBestseller ? 1 : 0) - (a.isBestseller ? 1 : 0)).slice(0, 4).map((i) => i.name),
        [all, vegNow],
    );
    // The food list updates AT ONCE when a filter changes (no waiting, no blank gap), and eases from slightly
    // faded back to full over a quarter second, so the change reads as smooth instead of a blink.
    const snapOf = () => ({ categories: f.categories, active: f.active, sort: f.sort, price: f.price, spice: f.spice, serves: f.serves, weight: f.weight });
    const [applied, setApplied] = useState(snapOf);
    const fade = useRef(new Animated.Value(1)).current;
    const sig = JSON.stringify(snapOf());
    const firstSig = useRef(true);
    // the customer is down the page with the sticky category bar showing: after a category change the list
    // is put back so its first result sits right under the bar (instead of jumping or showing the wrong place)
    const stuck = useRef(false);
    const panelH = useRef(0);
    const reanchor = useRef(false);
    const swapped = useRef(false);
    // While the list is being swapped, rows come and go and the "which rows are on screen" answer is briefly
    // wrong (the real category row can look visible for a moment). The sticky category bar must not react to
    // that, so it is held as it was and checked again once the new list is in and has faded back.
    const holdBar = useRef(false);
    const lastView = useRef({ cats: false, sec: '' });
    // A filter / category change never shows a reflow. Everything under the category row fades out (native
    // thread), the chip animations are allowed to finish, and ONLY THEN the list is swapped (and scrolled back
    // into place) while it is invisible; then it fades in. The user sees chips move smoothly and results appear.
    useEffect(() => {
        if (firstSig.current) { firstSig.current = false; return undefined; }
        let alive = true;
        holdBar.current = true;
        const out = Animated.timing(fade, { toValue: 0, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true });
        out.start(({ finished }) => {
            if (!finished || !alive) return;
            InteractionManager.runAfterInteractions(() => {
                if (!alive) return;
                reanchor.current = stuck.current;
                swapped.current = true;
                setApplied(snapOf());
            });
        });
        return () => { alive = false; out.stop(); };
    }, [sig]);

    const filtered = useMemo(
        () => applyFilters(all, applied, full.ratings.minCount),
        [all, applied, full.ratings.minCount],
    );
    const grouped = full.menu.groupByCategory;
    // the strips (offers, bestsellers...) are left out in the SAME render that swaps the list, so the page
    // changes height once, not twice (that was the jerk)
    const showStrips = applied.categories.length === 0;
    const extra = useMemo(() => ({ brand }), [brand]);

    const waiting = !loaded && !errorStatus;   // the menu has not arrived: show shapes instead of nothing
    const rows = useMemo(() => {
        const R = [{ t: 'header' }, { t: 'where' }];   // 'where': the shop's address and its Directions button (when switched on)
        const B = config.blocks;
        if (B.includes('search')) R.push({ t: 'search' });
        if (!full.restaurant.isOpen) R.push({ t: 'closed' });

        // the VEG switch also applies to the strips (bestsellers, combos, festival, new arrivals); an empty strip is not shown
        const vegOnly = applied.active.includes('veg_only');
        const keep = (list) => (vegOnly ? list.filter((p) => p.isVeg) : list);

        const pushItems = (list, cat) => {
            if (config.cardStyle === 'grid') {
                for (let i = 0; i < list.length; i += 2) R.push({ t: 'pair', a: list[i], b: list[i + 1], cat });
            } else list.forEach((item) => R.push({ t: 'item', item, cat }));
        };

        for (const b of B) {
            if (b === 'banner' && (banners.length || waiting)) R.push({ t: 'banner' });
            else if (b === 'categories' && (chips.length || waiting)) R.push({ t: 'cats' });
            else if (b === 'filters') R.push({ t: 'filters' });
            else if (b === 'offers' && showStrips && offers.length && full.offers.couponsEnabled && full.offers.showOnHome) R.push({ t: 'offers' });
            else if (!showStrips && ['bestsellers', 'festival', 'combos', 'new_arrivals'].includes(b)) continue;
            else if (b === 'bestsellers' && keep(recommended).length) R.push({ t: 'strip', id: 'best', title: 'Bestsellers', sub: 'Most ordered', items: keep(recommended), see: 'Bestsellers' });
            else if (b === 'festival') festival.forEach((c) => { const items = keep(c.products); if (items.length) R.push({ t: 'strip', id: `f${c.id}`, title: c.title, sub: c.subtitle || '', items }); });
            else if (b === 'combos') combo.forEach((c) => { const items = keep(c.products); if (items.length) R.push({ t: 'strip', id: `c${c.id}`, title: c.title, sub: c.subtitle || '', items }); });
            else if (b === 'new_arrivals') {
                const news = keep(all.filter((i) => i.isNewArrival)).slice(0, 10);
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
    }, [config, full, banners, chips, offers, recommended, festival, combo, all, filtered, grouped, menuCats, loaded, errorStatus, waiting, showStrips, applied.categories, applied.active]);

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
        lastView.current = { cats, sec };
        if (holdBar.current) return;
        stuck.current = cats;
        panel.current?.set(cats, sec);
    }).current;

    // the new list is in, still invisible: put the first result under the sticky bar (when the customer was down
    // the page), give the layout a frame, then fade it in
    useEffect(() => {
        if (!swapped.current) return undefined;
        swapped.current = false;
        const scroll = reanchor.current;
        reanchor.current = false;
        const target = menuIdx;
        let id2 = 0;
        const id1 = requestAnimationFrame(() => {
            if (scroll && target >= 0) {
                try { listRef.current?.scrollToIndex({ index: target, animated: false, viewOffset: barH + panelH.current }); } catch (e) { /* list not ready: stay */ }
            }
            id2 = requestAnimationFrame(() => {
                Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
                    if (!finished) return;
                    holdBar.current = false;
                    panel.current?.set(lastView.current.cats, lastView.current.sec);   // settle on the real answer
                });
            });
        });
        return () => { cancelAnimationFrame(id1); if (id2) cancelAnimationFrame(id2); };
    }, [applied]);

    const onOrder = (b) => {
        if (b.couponCode) nav.navigate('Offers');
        else if (menuIdx >= 0) listRef.current?.scrollToIndex({ index: menuIdx, animated: true });
    };

    const renderBase = ({ item: r }) => {
        switch (r.t) {
            case 'header': return <Header onAddress={() => setAddrOpen(true)} scrollY={scrollY} />;
            case 'search': return <StickyBar names={names} onHeight={setBarH} onMic={openVoice} />;
            case 'closed': return (
                <View style={[s.closed, { backgroundColor: brand.errorSoft }]}>
                    <Ionicons name="moon-outline" size={15} color={brand.errorText} />
                    <Text style={[s.closedTxt, { color: brand.errorText }]}>{closedText(full)}</Text>
                </View>
            );
            case 'where': return <StoreLocation />;
            case 'banner': return banners.length ? <FadeIn><Banners list={banners} onOrder={onOrder} /></FadeIn> : <SkelBanner />;
            case 'cats': return <FadeIn><Cats loading={waiting} /></FadeIn>;
            case 'filters': return <FadeIn index={1}><FiltersRow onOpen={() => setDlg(true)} /></FadeIn>;
            case 'offers': return <OffersStrip list={offers} />;
            case 'strip': return <Strip r={r} />;
            case 'sec': return <SecHead title={r.title} sub={r.sub} />;
            case 'item': return <ItemCard item={r.item} variant={config.cardStyle} />;
            case 'pair': return (
                <View style={s.pair}>
                    <View style={{ flex: 1 }}><ItemCard item={r.a} variant="grid" /></View>
                    <View style={{ flex: 1 }}>{r.b ? <ItemCard item={r.b} variant="grid" /> : null}</View>
                </View>
            );
            case 'loading': return <SkelFeed variant={config.cardStyle} count={3} />;
            case 'error': return (
                <View style={s.empty}>
                    <Ionicons name="cloud-offline-outline" size={34} color={brand.muted} />
                    <Text style={[s.emptyTxt, { color: brand.muted }]}>{tr('Could not load the menu')}</Text>
                    <Pressable onPress={loadMenu}><Text style={[s.link, { color: brand.primary, marginTop: 10 }]}>{tr('Try again')}</Text></Pressable>
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

    // everything under the category row takes part in the fade, so no height change is ever seen
    const FADE_ROWS = ['offers', 'strip', 'sec', 'item', 'pair', 'empty', 'loading', 'error'];
    const renderRow = (info) => {
        const node = renderBase(info);
        if (!FADE_ROWS.includes(info.item.t)) return node;
        return (
            <Animated.View style={{ opacity: fade }}>
                {node}
            </Animated.View>
        );
    };

    return (
        <View style={[{ flex: 1, backgroundColor: brand.background }, closedStyle]}>
            {/* the status bar area takes the header's top colour so the header flows into it */}
            {brand.look !== 'bold' ? <StatusBar barStyle={brand.dark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" /> : null}
            <View style={{ height: insets.top, backgroundColor: brand.look === 'bold' ? brand.primaryLight : brand.wash }} />
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
                onScroll={(e) => scrollY.setValue(e.nativeEvent.contentOffset.y)}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: space }}
            />
            {searchIdx >= 0 ? <StuckPanel ref={panel} top={insets.top + barH} grouped={grouped} onHeight={(h) => { panelH.current = h; }} /> : null}
            <CartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
            <AddressSheet
                visible={addrOpen}
                onClose={() => setAddrOpen(false)}
                selectedId={selectedAddr?._id}
                onSelect={(a) => useAddressStore.getState().setSelected(a)}
                onChanged={(items) => useAddressStore.getState().sync(items)}
            />
            <VoiceOverlay on={voice.on} txt={voice.txt} onStop={voice.stop} />
        </View>
    );
}

const s = StyleSheet.create({
    hd: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
    hdCompact: { paddingBottom: 14 },
    hdTitleCompact: { fontSize: 22, marginTop: 8 },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
    hdTop: { flexDirection: 'row', alignItems: 'center' },
    locBlock: { flex: 1, marginRight: 12 },
    locCap: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, opacity: 0.78 },
    hdTitle: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8, marginTop: 14 },
    hdTagline: { fontSize: 13.5, fontWeight: '500', opacity: 0.9, marginTop: 3 },
    hdTag: { fontSize: 12, opacity: 0.88, marginTop: 1 },
    ic: { width: 40, height: 40, borderRadius: 20, backgroundColor: glass, alignItems: 'center', justifyContent: 'center' },
    bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#E5383B', alignItems: 'center', justifyContent: 'center' },
    bellBadgeTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
    cBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    cBadgeTxt: { fontSize: 10, fontWeight: '800' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
    hChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: glass, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
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
    locRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 4, maxWidth: '100%' },
    locTxt: { flexShrink: 1, fontSize: 14.5, fontWeight: '600', marginLeft: 3, marginRight: 3 },
    locLabel: { fontWeight: '900' },
});