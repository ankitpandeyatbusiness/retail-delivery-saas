// src/ui/shop.jsx
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { create } from 'zustand';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore, useFavStore } from '../store/shopStores';

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

export function Pic({ item, style }) {
    return (
        <Image
            source={item.image ? { uri: item.image } : undefined}
            style={[{ backgroundColor: '#EEEEEE' }, style]}
            contentFit="cover" transition={150} cachePolicy="memory-disk"
        />
    );
}

function Meta({ item, full }) {
    const f = full.features;
    const rated = f.ratingBadge && item.rating > 0 && (item.ratingCount || 0) >= full.ratings.minCount;
    const bits = [];
    if (f.prepTime && item.prepTimeMin) bits.push(`${item.prepTimeMin} min`);
    if (f.serves && item.serves) bits.push(`Serves ${item.serves}`);
    if (f.calories && item.calories) bits.push(`${item.calories} kcal`);
    if (!rated && !bits.length) return null;
    return (
        <View style={s.meta}>
            {rated ? <View style={s.rate}><Text style={s.rateText}>{Number(item.rating).toFixed(1)} ★</Text></View> : null}
            <Text style={s.metaText}>{bits.join(' · ')}</Text>
        </View>
    );
}

function Price({ item }) {
    const { text } = useBrand();
    return (
        <View style={s.priceRow}>
            <Text style={[s.price, { color: text }]}>₹{item.price}</Text>
            {item.mrp > item.price ? <Text style={s.mrp}>₹{item.mrp}</Text> : null}
        </View>
    );
}

export function Heart({ item, style }) {
    const nav = useNavigation();
    const on = useFavStore((st) => st.ids.includes(item._id));
    const user = useAuthStore((st) => st.user);
    const press = async () => {
        if (!user) { showToast('Log in to save favourites'); nav.navigate('Login'); return; }
        const ok = await useFavStore.getState().toggle(item._id);
        if (!ok) showToast('Could not save. Try again.');
    };
    return (
        <Pressable onPress={press} hitSlop={8} style={[s.heart, style]}>
            <Text style={{ fontSize: 14 }}>{on ? '❤️' : '🤍'}</Text>
        </Pressable>
    );
}

function AddButton({ item, onPress, style }) {
    const { primary, radius } = useBrand();
    const label = useHomeStore((st) => st.full.labels.addButton);
    if (item.isAvailable === false) {
        return <View style={[s.so, { borderRadius: radius }, style]}><Text style={s.soText}>Sold out</Text></View>;
    }
    return (
        <Pressable onPress={onPress} style={[s.add, { borderColor: primary, borderRadius: radius }, style]}>
            <Text style={[s.addText, { color: primary }]}>{String(label).toUpperCase()}</Text>
        </Pressable>
    );
}

// Adds a dish straight to the cart, or opens the Item page when it needs a choice.
export function quickAdd(item, nav) {
    const full = useHomeStore.getState().full;
    if (!full.restaurant.isOpen) return showToast(closedText(full));
    if (item.isAvailable === false) return undefined;
    if ((item.optionGroups || []).some((g) => (g.min || 0) >= 1)) return nav.navigate('Item', { id: item._id });
    useCartStore.getState().add({
        productId: item._id, name: item.name, image: item.image, isVeg: item.isVeg,
        price: item.price, quantity: 1, selections: [], optionsText: '',
    });
    return showToast(`${item.name} added`);
}

/* ---------------- cards: big / compact / grid ---------------- */
function ItemCardBase({ item, variant }) {
    const nav = useNavigation();
    const full = useHomeStore((st) => st.full);
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const { text } = useBrand();
    const off = item.isAvailable === false;
    const open = () => nav.navigate('Item', { id: item._id });
    const heart = full.features.favourites ? <Heart item={item} /> : null;
    const add = <AddButton item={item} onPress={() => quickAdd(item, nav)} style={s.addPos} />;
    const info = (
        <View>
            <View style={s.nameRow}>
                {showDot ? <VegDot isVeg={item.isVeg} /> : null}
                <Text style={[s.name, { color: text }]} numberOfLines={variant === 'grid' ? 2 : 1}>{item.name}</Text>
            </View>
            <Meta item={item} full={full} />
            <Price item={item} />
        </View>
    );

    if (variant === 'compact') {
        return (
            <Pressable onPress={open} style={[s.compact, off && s.dim]}>
                <View style={{ flex: 1, paddingRight: 12 }}>{info}</View>
                <View style={s.cWrap}><Pic item={item} style={s.cImg} />{heart}{add}</View>
            </Pressable>
        );
    }
    if (variant === 'grid') {
        return (
            <Pressable onPress={open} style={[s.grid, off && s.dim]}>
                <View style={s.gWrap}><Pic item={item} style={s.gImg} />{heart}{add}</View>
                {info}
            </Pressable>
        );
    }
    return (
        <Pressable onPress={open} style={[s.big, off && s.dim]}>
            <View style={s.bWrap}><Pic item={item} style={s.bImg} />{heart}{add}</View>
            {info}
        </Pressable>
    );
}
export const ItemCard = React.memo(ItemCardBase);

/* ---------------- small tile for the horizontal strips ---------------- */
export function Tile({ item }) {
    const nav = useNavigation();
    const { text } = useBrand();
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const off = item.isAvailable === false;
    return (
        <Pressable onPress={() => nav.navigate('Item', { id: item._id })} style={[{ width: 130 }, off && s.dim]}>
            <View style={{ paddingBottom: 14 }}>
                <Pic item={item} style={{ width: 130, height: 100, borderRadius: 14 }} />
                {!off ? <AddButton item={item} onPress={() => quickAdd(item, nav)} style={[s.addPos, s.addTile]} /> : null}
            </View>
            <View style={s.nameRow}>
                {showDot ? <VegDot isVeg={item.isVeg} /> : null}
                <Text numberOfLines={1} style={[s.tn, { color: text }]}>{item.name}</Text>
            </View>
            <Text style={[s.tp, { color: text }]}>₹{item.price}</Text>
        </Pressable>
    );
}

/* ---------------- floating "View cart" bar ---------------- */
export function CartBar() {
    const nav = useNavigation();
    const { primary, radius } = useBrand();
    const count = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity, 0));
    const total = useCartStore((st) => st.lines.reduce((a, l) => a + l.quantity * l.price, 0));
    if (!count) return null;
    return (
        <Pressable onPress={() => nav.navigate('Cart')} style={[s.bar, { backgroundColor: primary, borderRadius: radius }]}>
            <Text style={s.barText}>{count} item{count > 1 ? 's' : ''} · ₹{+total.toFixed(2)}</Text>
            <Text style={s.barText}>View cart ›</Text>
        </Pressable>
    );
}

const s = StyleSheet.create({
    toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 99 },
    toast: { backgroundColor: '#1C1C1C', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99 },
    toastText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    dotBox: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { flex: 1, fontSize: 15, fontWeight: '700' },
    meta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    rate: { backgroundColor: '#1E8E3E', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, marginRight: 6 },
    rateText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
    metaText: { fontSize: 11, color: '#777777' },
    priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    price: { fontSize: 14, fontWeight: '700' },
    mrp: { marginLeft: 6, fontSize: 12, color: '#999999', textDecorationLine: 'line-through' },
    heart: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center' },
    add: { backgroundColor: '#FFFFFF', borderWidth: 1, paddingHorizontal: 24, paddingVertical: 6, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
    addText: { fontSize: 13, fontWeight: '800' },
    addPos: { position: 'absolute', bottom: 0, alignSelf: 'center' },
    addTile: { paddingHorizontal: 18, paddingVertical: 4 },
    so: { backgroundColor: '#EEEEEE', paddingHorizontal: 12, paddingVertical: 5 },
    soText: { fontSize: 11, fontWeight: '700', color: '#888888' },
    dim: { opacity: 0.5 },
    big: { marginHorizontal: 16, marginBottom: 18 },
    bWrap: { paddingBottom: 14, marginBottom: 6 },
    bImg: { width: '100%', height: 170, borderRadius: 16 },
    compact: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DDDDDD' },
    cWrap: { width: 110, paddingBottom: 14 },
    cImg: { width: 110, height: 100, borderRadius: 14 },
    grid: { margin: 6 },
    gWrap: { paddingBottom: 14, marginBottom: 6 },
    gImg: { width: '100%', height: 110, borderRadius: 14 },
    tn: { flex: 1, fontSize: 12, marginTop: 4 },
    tp: { fontSize: 12, fontWeight: '700', marginTop: 2 },
    bar: { position: 'absolute', left: 12, right: 12, bottom: 12, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', elevation: 6 },
    barText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});