// src/components/customers/favourites.jsx
//
// The customer's saved dishes, offered inside the cart:
//   mode 'list'  - the cart is empty: "Order from your favourites", as full dish cards with their ADD buttons
//   mode 'strip' - the cart has food: "Add from your favourites", a sideways strip (dishes already in the cart are left out)
// Nothing is shown to a guest, when the shop has favourites switched off, or when there is nothing to show.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { FadeIn, Skel } from '../common/motion';
import { Tile, ItemCard } from './shop';
import { SkelDish } from './skeletons';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useCartStore, useFavStore } from '../../store/customers/shopStores';
import { fetchFavourites } from '../../api/customers/shopApi';

export function FavouriteDishes({ mode = 'strip' }) {
    const { primary, text, muted } = useBrand();
    const user = useAuthStore((st) => st.user);
    const enabled = useHomeStore((st) => st.full.features.favourites);
    const lines = useCartStore((st) => st.lines);
    const favCount = useFavStore((st) => st.ids.length);
    const [items, setItems] = useState(null);   // null = still loading

    const load = useCallback(async () => {
        try {
            const r = await fetchFavourites();
            setItems(r.items || []);
        } catch (e) {
            setItems((prev) => prev || []);
        }
    }, []);
    // refresh whenever the cart page is shown or a heart is added or removed
    useFocusEffect(useCallback(() => { if (user && enabled) load(); }, [user, enabled, load, favCount]));

    const list = useMemo(() => {
        const inCart = new Set(lines.map((l) => String(l.productId)));
        // the favourites LIST keeps a sold-out dish (greyed out); the quick-add strip only offers dishes that can be added
        return (items || []).filter((i) => (mode === 'list' || (i.isAvailable !== false && !inCart.has(String(i._id)))));
    }, [items, lines, mode]);

    if (!user || !enabled) return null;
    if (items !== null && !list.length) return null;

    const title = mode === 'list' ? 'Order from your favourites' : 'Add from your favourites';
    const sub = mode === 'list' ? 'Dishes you saved, one tap to add' : 'Saved dishes that go well with this order';

    return (
        <FadeIn index={1} style={mode === 'strip' ? { marginTop: 22 } : { flex: 1, marginTop: 4 }}>
            <View style={[s.head, mode === 'list' && { paddingHorizontal: 20 }]}>
                <View style={[s.ic, { backgroundColor: `${primary}1F` }]}><Ionicons name="heart" size={15} color={primary} /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[s.title, { color: text }]}>{title}</Text>
                    <Text style={[s.sub, { color: muted }]}>{sub}</Text>
                </View>
            </View>

            {items === null ? (
                mode === 'list' ? (
                    <View style={{ paddingTop: 12 }}>{[0, 1].map((i) => <SkelDish key={i} variant="compact" />)}</View>
                ) : (
                    <View style={s.skelRow}>{[0, 1, 2].map((i) => <Skel key={i} width={148} height={190} radius={18} style={{ marginRight: 10 }} />)}</View>
                )
            ) : mode === 'list' ? (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
                    {list.slice(0, 8).map((it, i) => (
                        <FadeIn key={it._id} index={i}><ItemCard item={it} variant="compact" /></FadeIn>
                    ))}
                </ScrollView>
            ) : (
                <FlatList
                    horizontal data={list} showsHorizontalScrollIndicator={false}
                    keyExtractor={(i) => i._id}
                    style={s.stripBleed}
                    contentContainerStyle={s.strip}
                    ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                    renderItem={({ item }) => <Tile item={item} push />}
                />
            )}
        </FadeIn>
    );
}

const s = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center' },
    ic: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
    sub: { fontSize: 11.5, marginTop: 1 },
    stripBleed: { marginHorizontal: -16, marginTop: 10 },
    strip: { paddingHorizontal: 16, paddingVertical: 6 },
    skelRow: { flexDirection: 'row', marginTop: 10 },
});
