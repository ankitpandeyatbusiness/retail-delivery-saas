// src/components/ui/shop.jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { useHomeStore } from '../../store/useHomeStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore, useFavStore } from '../../store/shopStores';
import SlideNum from './SlideNum';

export const tint = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? `${c}1F` : '#F5F5F5');

/* ---------------- toast ---------------- */
const useToast = create((set) => ({ msg: '', n: 0, show: (msg) => set((st) => ({ msg, n: st.n + 1 })) }));
export const showToast = (msg) => useToast.getState().show(msg);

export function ToastHost() {
    const msg = useToast((st) => st.msg);
    const n = useToast((st) => st.n);
    const [on, setOn] = useState(false);
    const insets = useSafeAreaInsets();
    useEffect(() => {
        if (!n) return undefined;
        setOn(true);
        const t = setTimeout(() => setOn(false), 1800);
        return () => clearTimeout(t);
    }, [n]);
    if (!on) return null;
    return (
        <View pointerEvents="none" style={[s.toastWrap, { top: insets.top + 12 }]}>
            <View style={s.toast}><Text style={s.toastText}>{msg}</Text></View>
        </View>
    );
}

export const closedText = (full) =>
    full.restaurant.closedReason === 'paused'
        ? 'Not accepting orders right now'
        : (full.hours?.closedMessage || full.labels.closedMessage);

/* ---------------- small pieces ---------------- */
export function VegDot({ isVeg }) {
    const c = isVeg ? '#0F8A3C' : '#B3261E';
    return (
        <View style={[s.dotBox, { borderColor: c }]}><View style={[s.dot, { backgroundColor: c }]} /></View>
    );
}

// Dish photo. With no photo it shows a brand-tinted tile with the first letter.
export function Pic({ item, style }) {
    const { primary, soft } = useBrand();
    if (!item.image) {
        return (
            <View style={[{ backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }, style]}>
                <Text style={{ color: primary, fontSize: 30, fontWeight: '800', opacity: 0.7 }}>{(item.name || '?')[0].toUpperCase()}</Text>
            </View>
        );
    }
    return (
        <Image
            source={{ uri: item.image }}
            style={[{ backgroundColor: soft }, style]}
            contentFit="cover" transition={150} cachePolicy="memory-disk"
        />
    );
}

function Meta({ item, full }) {
    const { muted } = useBrand();
    const f = full.features;
    const rated = f.ratingBadge && item.rating > 0 && (item.ratingCount || 0) >= full.ratings.minCount;
    const bits = [];
    if (f.prepTime && item.prepTimeMin) bits.push(`${item.prepTimeMin} min`);
    if (f.serves && item.serves) bits.push(`Serves ${item.serves}`);
    if (f.calories && item.calories) bits.push(`${item.calories} kcal`);
    if (!rated && !bits.length) return null;
    return (
        <View style={s.meta}>
            {rated ? (
                <View style={s.rate}>
                    <Text style={s.rateText}>{Number(item.rating).toFixed(1)}</Text>
                    <Ionicons name="star" size={9} color="#FFFFFF" style={{ marginLeft: 2 }} />
                </View>
            ) : null}
            {bits.length ? <Text style={[s.metaText, { color: muted }]}>{bits.join(' · ')}</Text> : null}
        </View>
    );
}

const offPct = (item) => (item.mrp > item.price ? Math.round(100 - (item.price * 100) / item.mrp) : 0);

function Price({ item, big }) {
    const { text, muted } = useBrand();
    return (
        <View style={s.priceRow}>
            <Text style={[big ? s.priceBig : s.price, { color: text }]}>₹{item.price}</Text>
            {item.mrp > item.price ? <Text style={[s.mrp, { color: muted }]}>₹{item.mrp}</Text> : null}
        </View>
    );
}

export function Heart({ item, style }) {
    const nav = useNavigation();
    const { primary } = useBrand();
    const on = useFavStore((st) => st.ids.includes(item._id));
    const user = useAuthStore((st) => st.user);
    const press = async () => {
        if (!user) { showToast('Log in to save favourites'); nav.navigate('Login'); return; }
        const ok = await useFavStore.getState().toggle(item._id);
        if (!ok) showToast('Could not save. Try again.');
    };
    return (
        <Pressable onPress={press} hitSlop={8} style={[s.heart, style]}>
            <Ionicons name={on ? 'heart' : 'heart-outline'} size={18} color={on ? primary : '#444444'} />
        </Pressable>
    );
}

// removes one from the most recently added version of this dish
const removeOne = (id) => {
    const st = useCartStore.getState();
    const mine = st.lines.filter((l) => l.productId === id);
    const last = mine[mine.length - 1];
    if (last) st.setQty(last.key, last.quantity - 1);
};

function Stepper({ qty, kind, onInc, onDec, style }) {
    const { primary, onPrimary, radius } = useBrand();
    const light = kind === 'overlap';
    const small = kind === 'circle';
    const fg = light ? primary : onPrimary;
    return (
        <View
            style={[
                s.step,
                { width: small ? 78 : 92, height: small ? 32 : 34, borderRadius: small ? 16 : radius, borderColor: primary, backgroundColor: light ? '#FFFFFF' : primary },
                light && s.stepLift,
                style,
            ]}
        >
            <Pressable onPress={onDec} hitSlop={8} style={s.stepBtn}><Ionicons name="remove" size={16} color={fg} /></Pressable>
            <SlideNum value={qty} minWidth={18} style={[s.stepQty, { color: fg }]} />
            <Pressable onPress={onInc} hitSlop={8} style={s.stepBtn}><Ionicons name="add" size={16} color={fg} /></Pressable>
        </View>
    );
}

// Small spring when the button switches between "Add" and the stepper.
// It skips the first render, so cards that scroll into view stay still.
function Pop({ mode, style, children }) {
    const v = useRef(new Animated.Value(1)).current;
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        v.setValue(0);
        Animated.spring(v, { toValue: 1, friction: 6, tension: 180, useNativeDriver: true }).start();
    }, [mode]);
    return (
        <Animated.View style={[style, {
            opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
        }]}>
            {children}
        </Animated.View>
    );
}

// kind: 'pill' (filled), 'overlap' (white pill that sits on the photo), 'circle' (icon only)
// Once the dish is in the cart, the button turns into  −  1  +
export function AddButton({ item, onPress, kind = 'pill', style }) {
    const { primary, onPrimary, radius } = useBrand();
    const label = useHomeStore((st) => st.full.labels.addButton);
    const qty = useCartStore((st) => st.lines.reduce((a, l) => (l.productId === item._id ? a + l.quantity : a), 0));
    if (item.isAvailable === false) {
        return <View style={[s.so, { borderRadius: radius }, style]}><Text style={s.soText}>Sold out</Text></View>;
    }
    const mode = qty > 0 ? 'step' : 'add';
    let inner;
    if (qty > 0) {
        inner = <Stepper qty={qty} kind={kind} onInc={onPress} onDec={() => removeOne(item._id)} />;
    } else if (kind === 'circle') {
        inner = (
            <Pressable onPress={onPress} hitSlop={6} style={[s.circle, { backgroundColor: primary }]}>
                <Ionicons name="add" size={20} color={onPrimary} />
            </Pressable>
        );
    } else if (kind === 'overlap') {
        inner = (
            <Pressable onPress={onPress} style={[s.overlap, { borderColor: primary, borderRadius: radius }]}>
                <Text style={[s.overlapTxt, { color: primary }]}>{String(label).toUpperCase()}</Text>
                <Ionicons name="add" size={14} color={primary} style={{ marginLeft: 2 }} />
            </Pressable>
        );
    } else {
        inner = (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [s.pill, { backgroundColor: primary, borderRadius: radius }, pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] }]}
            >
                <Text style={[s.pillTxt, { color: onPrimary }]}>{String(label).toUpperCase()}</Text>
                <Ionicons name="add" size={15} color={onPrimary} style={{ marginLeft: 2 }} />
            </Pressable>
        );
    }
    // `style` (the absolute position on photos) now sits on the wrapper, so the pop never moves the button
    return <Pop mode={mode} style={style}>{inner}</Pop>;
}

// Adds a dish straight to the cart, or opens the Item page when it needs a choice.
export function quickAdd(item, nav) {
    const full = useHomeStore.getState().full;
    if (!full.restaurant.isOpen) return showToast(closedText(full));
    if (item.isAvailable === false) return undefined;
    // already in the cart: just add one more to the latest version of this dish
    const st = useCartStore.getState();
    const mine = st.lines.filter((l) => l.productId === item._id);
    const last = mine[mine.length - 1];
    if (last) {
        if (last.quantity >= 20) return showToast('Max 20 per item');
        st.setQty(last.key, last.quantity + 1);
        return undefined;
    }
    if ((item.optionGroups || []).some((g) => (g.min || 0) >= 1)) return nav.navigate('Item', { id: item._id });
    useCartStore.getState().add({
        productId: item._id, name: item.name, image: item.image, isVeg: item.isVeg,
        price: item.price, quantity: 1, selections: [], optionsText: '',
    });
    return undefined;
}

/* ---------------- cards: big / compact / grid ---------------- */
function ItemCardBase({ item, variant }) {
    const nav = useNavigation();
    const full = useHomeStore((st) => st.full);
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const { text, surface, border, primary, onPrimary, dark } = useBrand();
    const off = item.isAvailable === false;
    const dim = off && full.menu.outOfStock === 'dim';
    const open = () => nav.navigate('Item', { id: item._id });
    const heart = full.features.favourites ? <Heart item={item} /> : null;
    const pct = offPct(item);
    const card = { backgroundColor: surface, shadowColor: dark ? '#000000' : primary, borderColor: border };
    const press = ({ pressed }) => pressed && { transform: [{ scale: 0.985 }] };
    const press2 = (extra) => (st) => [extra, press(st)];
    const name = (lines) => (
        <View style={s.nameRow}>
            {showDot ? <VegDot isVeg={item.isVeg} /> : null}
            <Text style={[s.name, { color: text }]} numberOfLines={lines}>{item.name}</Text>
        </View>
    );

    if (variant === 'compact') {
        return (
            <Pressable onPress={open} style={press2([s.compact, card, dim && s.dim])}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                    {name(2)}
                    <Meta item={item} full={full} />
                    <Price item={item} />
                    {pct ? <Text style={s.offTxt}>{pct}% off</Text> : null}
                </View>
                <View style={s.cWrap}>
                    <Pic item={item} style={s.cImg} />
                    {heart}
                    <AddButton item={item} kind="overlap" onPress={() => quickAdd(item, nav)} style={s.overPos} />
                </View>
            </Pressable>
        );
    }
    if (variant === 'grid') {
        return (
            <Pressable onPress={open} style={press2([s.grid, card, dim && s.dim])}>
                <View>
                    <Pic item={item} style={s.gImg} />
                    {heart}
                    {pct ? <View style={s.badge}><Text style={s.badgeTxt}>{pct}% OFF</Text></View> : null}
                </View>
                <View style={s.gBody}>
                    {name(2)}
                    <Meta item={item} full={full} />
                    <View style={s.rowEnd}>
                        <Price item={item} />
                        <AddButton item={item} kind="circle" onPress={() => quickAdd(item, nav)} />
                    </View>
                </View>
            </Pressable>
        );
    }
    return (
        <Pressable onPress={open} style={press2([s.big, card, dim && s.dim])}>
            <View>
                <Pic item={item} style={s.bImg} />
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} style={s.bShade} />
                {heart}
                {pct ? <View style={[s.badge, { backgroundColor: primary }]}><Text style={[s.badgeTxt, { color: onPrimary }]}>{pct}% OFF</Text></View> : null}
            </View>
            <View style={s.bBody}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                    {name(1)}
                    <Meta item={item} full={full} />
                    <Price item={item} big />
                </View>
                <AddButton item={item} onPress={() => quickAdd(item, nav)} />
            </View>
        </Pressable>
    );
}
export const ItemCard = React.memo(ItemCardBase);

/* ---------------- small tile for the horizontal strips ---------------- */
export function Tile({ item }) {
    const nav = useNavigation();
    const { text, muted, surface, border } = useBrand();
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const off = item.isAvailable === false;
    return (
        <Pressable
            onPress={() => nav.navigate('Item', { id: item._id })}
            style={({ pressed }) => [s.tile, { backgroundColor: surface, borderColor: border }, off && s.dim, pressed && { transform: [{ scale: 0.97 }] }]}
        >
            <View>
                <Pic item={item} style={s.tImg} />
                {!off ? <AddButton item={item} kind="circle" onPress={() => quickAdd(item, nav)} style={s.tAdd} /> : null}
            </View>
            <View style={{ padding: 9 }}>
                <View style={s.nameRow}>
                    {showDot ? <VegDot isVeg={item.isVeg} /> : null}
                    <Text numberOfLines={1} style={[s.tn, { color: text }]}>{item.name}</Text>
                </View>
                <View style={s.priceRow}>
                    <Text style={[s.price, { color: text }]}>₹{item.price}</Text>
                    {item.mrp > item.price ? <Text style={[s.mrp, { color: muted }]}>₹{item.mrp}</Text> : null}
                </View>
            </View>
        </Pressable>
    );
}

/* ---------------- floating "View cart" bar ---------------- */
export function CartBar() {
    const nav = useNavigation();
    const { primaryLight, primaryDark, onPrimary, radius } = useBrand();
    const count = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity, 0));
    const total = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity * l.price, 0));
    if (!count) return null;
    return (
        <Pressable onPress={() => nav.navigate('Cart')} style={[s.bar, { borderRadius: Math.max(radius, 14) }]}>
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.barIn, { borderRadius: Math.max(radius, 14) }]}>
                <View style={s.barIcon}><Ionicons name="bag-handle" size={18} color={onPrimary} /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[s.barText, { color: onPrimary }]}>{count} item{count > 1 ? 's' : ''}</Text>
                    <Text style={[s.barSub, { color: onPrimary }]}>₹{+total.toFixed(2)}</Text>
                </View>
                <Text style={[s.barText, { color: onPrimary }]}>View cart</Text>
                <Ionicons name="chevron-forward" size={18} color={onPrimary} />
            </LinearGradient>
        </Pressable>
    );
}

const shadow = { elevation: 4, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } };

const s = StyleSheet.create({
    toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 99 },
    toast: { backgroundColor: '#1C1C1C', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99 },
    toastText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    dotBox: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { flex: 1, fontSize: 16, fontWeight: '800' },
    meta: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
    rate: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E8E3E', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8 },
    rateText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    metaText: { fontSize: 12 },
    priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    step: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1 },
    stepLift: { elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    stepBtn: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
    stepQty: { fontSize: 14, fontWeight: '800', minWidth: 18, textAlign: 'center' },
    price: { fontSize: 14, fontWeight: '800' },
    priceBig: { fontSize: 17, fontWeight: '800' },
    mrp: { marginLeft: 6, fontSize: 12, textDecorationLine: 'line-through' },
    offTxt: { marginTop: 3, fontSize: 11, fontWeight: '800', color: '#1E8E3E' },
    heart: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', left: 10, bottom: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeTxt: { fontSize: 11, fontWeight: '800', color: '#1E8E3E' },
    pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 9 },
    pillTxt: { fontSize: 13, fontWeight: '800' },
    overlap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, paddingHorizontal: 18, paddingVertical: 6, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    overlapTxt: { fontSize: 13, fontWeight: '800' },
    overPos: { position: 'absolute', bottom: -14, alignSelf: 'center' },
    circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 3 },
    so: { backgroundColor: '#EEEEEE', paddingHorizontal: 12, paddingVertical: 6 },
    soText: { fontSize: 11, fontWeight: '700', color: '#888888' },
    dim: { opacity: 0.5 },
    big: { marginHorizontal: 16, marginBottom: 18, borderRadius: 22, ...shadow },
    bImg: { width: '100%', height: 190, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
    bShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
    bBody: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    compact: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, padding: 14, paddingBottom: 22, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, ...shadow, elevation: 2, shadowOpacity: 0.08 },
    cWrap: { width: 112 },
    cImg: { width: 112, height: 104, borderRadius: 16 },
    grid: { margin: 6, borderRadius: 18, ...shadow, elevation: 3 },
    gImg: { width: '100%', height: 120, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
    gBody: { padding: 10 },
    rowEnd: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
    tile: { width: 148, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
    tImg: { width: 148, height: 112 },
    tAdd: { position: 'absolute', right: 8, bottom: 8 },
    tn: { flex: 1, fontSize: 13, fontWeight: '700' },
    bar: { position: 'absolute', left: 12, right: 12, bottom: 12, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    barIn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
    barIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    barText: { fontWeight: '800', fontSize: 14 },
    barSub: { fontSize: 12, opacity: 0.9, marginTop: 1 },
});