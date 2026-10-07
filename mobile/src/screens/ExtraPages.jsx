// src/screens/ExtraPages.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand, BackHeader } from '../ui/kit';
import { ItemCard, CartBar, showToast, tint } from '../ui/shop';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { useMenuStore, useCartStore, useFavStore } from '../store/shopStores';
import { useCouponStore } from '../store/useCouponStore';
import { fetchOffers } from '../api/catalogApi';
import { fetchFavourites } from '../api/shopApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- Offers ---------------- */
function offerText(o) {
    if (o.description) return o.description;
    if (o.discountType === 'percent') return `${o.discountValue}% off${o.maxDiscount ? ` up to ₹${o.maxDiscount}` : ''}`;
    return `₹${o.discountValue} off`;
}

export function OffersScreen() {
    const nav = useNavigation();
    const { primary, radius, text } = useBrand();
    const user = useAuthStore((st) => st.user);
    const storeOffers = useHomeStore((st) => st.offers);
    const enabled = useHomeStore((st) => st.full.offers.couponsEnabled);
    const hasLines = useCartStore((st) => st.lines.length > 0);
    const [list, setList] = useState(storeOffers);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let on = true;
        fetchOffers()
            .then((r) => { if (on) setList(r.items || []); })
            .catch(() => { })
            .finally(() => { if (on) setLoading(false); });
        return () => { on = false; };
    }, []);

    const apply = (o) => {
        if (!user) { showToast('Log in to use coupons'); return; }
        useCouponStore.getState().set(o.code);
        if (!hasLines) { showToast(`${o.code} saved. Add items to use it`); return; }
        const routes = nav.getState().routes;
        if (routes[routes.length - 2]?.name === 'Cart') nav.goBack(); else nav.navigate('Cart');
    };

    const shown = enabled ? list : [];
    return (
        <View style={s.flex}>
            <BackHeader title="Offers" />
            {loading && !shown.length ? <ActivityIndicator style={{ margin: 40 }} color={primary} /> : (
                <FlatList
                    data={shown} keyExtractor={(o) => o._id}
                    contentContainerStyle={{ padding: 16 }}
                    ListEmptyComponent={<Text style={s.empty}>No offers right now</Text>}
                    renderItem={({ item: o }) => {
                        const end = o.endsAt ? new Date(o.endsAt) : null;
                        return (
                            <View style={[s.offer, { borderColor: primary, backgroundColor: tint(primary) }]}>
                                <View style={s.oTop}>
                                    <Text style={[s.code, { color: primary }]}>{o.code}</Text>
                                    <Pressable onPress={() => apply(o)} style={[s.apply, { borderColor: primary, borderRadius: radius }]}>
                                        <Text style={[s.applyTxt, { color: primary }]}>Apply</Text>
                                    </Pressable>
                                </View>
                                <Text style={[s.oDesc, { color: text }]}>{offerText(o)}</Text>
                                <Text style={s.oMeta}>
                                    {[
                                        o.minOrder ? `Min order ₹${o.minOrder}` : '',
                                        o.firstOrderOnly ? 'First order only' : '',
                                        end ? `Ends ${end.getDate()} ${MONTHS[end.getMonth()]}` : '',
                                    ].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                        );
                    }}
                />
            )}
        </View>
    );
}

/* ---------------- Bestsellers ---------------- */
export function BestsellersScreen() {
    const { text } = useBrand();
    const name = useThemeStore((st) => st.theme.name);
    const cats = useMenuStore((st) => st.categories);
    const loaded = useMenuStore((st) => st.loaded);
    const list = useMemo(
        () => cats.flatMap((c) => c.items).filter((i) => i.isBestseller).sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0)),
        [cats],
    );
    useEffect(() => { if (!loaded) useMenuStore.getState().load(); }, []);

    return (
        <View style={s.flex}>
            <BackHeader title="Bestsellers" />
            <FlatList
                data={list} keyExtractor={(i) => i._id}
                ListHeaderComponent={<Text style={[s.sub, { color: text }]}>Most ordered at {name}</Text>}
                ListEmptyComponent={<Text style={s.empty}>No bestsellers yet</Text>}
                renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                contentContainerStyle={{ paddingBottom: 90 }}
            />
            <CartBar />
        </View>
    );
}

/* ---------------- Favourites ---------------- */
export function FavouritesScreen() {
    const nav = useNavigation();
    const { primary, radius, text } = useBrand();
    const user = useAuthStore((st) => st.user);
    const enabled = useHomeStore((st) => st.full.features.favourites);
    const ids = useFavStore((st) => st.ids);
    const [items, setItems] = useState([]);
    const [state, setState] = useState('loading'); // loading | ok | error
    const prev = useRef(ids);

    const load = useCallback(async () => {
        try { setItems((await fetchFavourites()).items || []); setState('ok'); } catch (e) { setState('error'); }
    }, []);
    useFocusEffect(useCallback(() => { if (user && enabled) load(); }, [user, enabled, load]));

    // a heart un-tapped on this page removes the card right away
    useEffect(() => {
        const removed = prev.current.filter((x) => !ids.includes(x));
        prev.current = ids;
        if (removed.length) setItems((p) => p.filter((i) => !removed.includes(i._id)));
    }, [ids]);

    const msg = (title, sub, btn) => (
        <View style={s.flex}>
            <BackHeader title="Favourites" />
            <View style={s.center}>
                <Text style={[s.big, { color: text }]}>{title}</Text>
                {sub ? <Text style={s.empty}>{sub}</Text> : null}
                {btn}
            </View>
        </View>
    );

    if (!enabled) return msg('Favourites are not available', '');
    if (!user) {
        return msg('Log in to see your favourites', '', (
            <Pressable onPress={() => nav.navigate('Login')} style={[s.cta, { backgroundColor: primary, borderRadius: radius }]}>
                <Text style={s.ctaTxt}>Log in</Text>
            </Pressable>
        ));
    }

    return (
        <View style={s.flex}>
            <BackHeader title="Favourites" />
            {state === 'loading' ? <ActivityIndicator style={{ margin: 40 }} color={primary} />
                : state === 'error' && !items.length ? (
                    <View style={s.center}>
                        <Text style={s.empty}>Could not load favourites</Text>
                        <Pressable onPress={load}><Text style={[s.link, { color: primary }]}>Try again</Text></Pressable>
                    </View>
                ) : (
                    <FlatList
                        data={items} keyExtractor={(i) => i._id}
                        ListEmptyComponent={<Text style={s.empty}>No favourites yet. Tap the heart on any dish.</Text>}
                        renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                        contentContainerStyle={{ paddingTop: 8, paddingBottom: 90 }}
                    />
                )}
            <CartBar />
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#FFFFFF' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
    empty: { fontSize: 14, color: '#777777', textAlign: 'center', padding: 30 },
    link: { marginTop: 12, fontSize: 13, fontWeight: '700' },
    cta: { marginTop: 18, paddingHorizontal: 32, paddingVertical: 12 },
    ctaTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    sub: { fontSize: 12, color: '#777777', paddingHorizontal: 16, paddingBottom: 14 },
    offer: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, padding: 14, marginBottom: 12 },
    oTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    code: { fontSize: 16, fontWeight: '800', letterSpacing: 1 },
    apply: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#FFFFFF' },
    applyTxt: { fontSize: 12, fontWeight: '800' },
    oDesc: { fontSize: 14, fontWeight: '600', marginTop: 6 },
    oMeta: { fontSize: 11, color: '#777777', marginTop: 4 },
});