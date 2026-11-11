// src/screens/ExtraPages.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ListShimmer } from '../../components/owners/shimmer';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, BackHeader } from '../../components/common/kit';
import BulkCartBar from '../../components/customers/BulkCartBar';
import { ItemCard, CartBar, showToast, tint, useClosedStyle } from '../../components/customers/shop';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useMenuStore, useCartStore, useFavStore } from '../../store/customers/shopStores';
import { useCouponStore } from '../../store/customers/useCouponStore';
import { fetchOffers } from '../../api/customers/catalogApi';
import { fetchFavourites } from '../../api/customers/shopApi';
import { copyCode } from '../../components/common/copyCode';
import { CouponTicket } from '../../components/customers/coupon';
import { FadeIn, Skel } from '../../components/common/motion';
import { useCustomerDesktop } from '../../utils/common/layout';
import { DeskPage, DeskHeader, DeskBtn } from '../../components/common/DeskPage';
import { tr } from '../../i18n';
import { useBottomSpace } from '../../store/customers/useLiveTripStore';
import { useOrderMode } from '../../store/customers/useOrderMode';

/* ---------------- Offers ---------------- */
export function OffersScreen() {
    const desk = useCustomerDesktop();   // the desktop website (a wide browser): a two-column page. False in the phone app.
    const space = useBottomSpace();   // room for the floating order bar, only while it is on screen
    const closedStyle = useClosedStyle();
    const { background, muted } = useBrand();
    const storeOffers = useHomeStore((st) => st.offers);
    const enabled = useHomeStore((st) => st.full.offers.couponsEnabled);
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let on = true;
        fetchOffers()
            .then((r) => { if (on) setList(r.items || []); })
            .catch(() => { })
            .finally(() => { if (on) setLoading(false); });
        return () => { on = false; };
    }, []);



    const mode = useOrderMode((st) => st.mode);
    const shown = enabled ? list.filter((o) => !o.dineInOnly || mode === 'dine_in') : [];
    if (desk) return <OffersDesktop shown={shown} loading={loading} closedStyle={closedStyle} />;
    return (
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <BackHeader title={tr('Offers')} />
            {loading && !shown.length ? (
                <View style={{ padding: 16 }}>
                    {[0, 1, 2].map((i) => <Skel key={i} height={108} radius={18} style={{ marginBottom: 14 }} />)}
                </View>
            ) : (
                <FlatList
                    data={shown} keyExtractor={(o) => o._id}
                    contentContainerStyle={{ padding: 16, paddingBottom: space }}
                    ListHeaderComponent={shown.length ? <Text style={[s.sub, { color: muted, paddingHorizontal: 2 }]}>{tr('Tap a coupon to copy its code, then paste it in your cart')}</Text> : null}
                    ListEmptyComponent={<Text style={s.empty}>{tr('No offers right now')}</Text>}
                    renderItem={({ item: o, index }) => (
                        <FadeIn index={index} style={{ marginBottom: 14 }}>
                            <CouponTicket o={o} size="full" onPress={() => copyCode(o.code)} />
                        </FadeIn>
                    )}
                />
            )}
        </View>
    );
}

/* ---------------- Offers on the desktop website: the coupons in two columns ---------------- */
// The same ticket as everywhere (CouponTicket), a header with a back button, and a hint line. An odd last coupon keeps its column width.
function OffersDesktop({ shown, loading, closedStyle }) {
    const nav = useNavigation();
    const { background, muted, text, border, surface, primary } = useBrand();
    const COLS = 2;
    const rows = [];
    for (let i = 0; i < shown.length; i += COLS) rows.push(shown.slice(i, i + COLS));
    return (
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
                <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 22 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Pressable
                            onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))}
                            accessibilityRole="button"
                            accessibilityLabel={tr('Back')}
                            style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: hovered ? border : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '160ms' })}
                        >
                            <Ionicons name="arrow-back" size={24} color={text} />
                        </Pressable>
                        <Text style={{ color: text, fontSize: 28, fontWeight: '900', letterSpacing: -0.4 }}>{tr('Offers')}</Text>
                    </View>
                    {shown.length ? <Text style={{ color: muted, fontSize: 13.5, marginTop: 14, marginBottom: 18 }}>{tr('Tap a coupon to copy its code, then paste it in your cart')}</Text> : <View style={{ height: 18 }} />}

                    {loading && !shown.length ? (
                        <View style={{ gap: 16 }}>
                            {[0, 1, 2].map((i) => (
                                <View key={i} style={{ flexDirection: 'row', gap: 16 }}>
                                    {[0, 1].map((j) => <View key={j} style={{ flex: 1 }}><Skel height={108} radius={18} /></View>)}
                                </View>
                            ))}
                        </View>
                    ) : !shown.length ? (
                        <View style={{ alignItems: 'center', paddingVertical: 70 }}>
                            <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="pricetags-outline" size={36} color={muted} />
                            </View>
                            <Text style={{ color: text, fontSize: 18, fontWeight: '800', marginTop: 18 }}>{tr('No offers right now')}</Text>
                            <Pressable onPress={() => nav.navigate('MainTabs')} style={({ hovered }) => ({ marginTop: 14, opacity: hovered ? 0.7 : 1, cursor: 'pointer' })}>
                                <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>{tr('Browse the menu')}</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={{ gap: 16 }}>
                            {rows.map((r, ri) => (
                                <View key={ri} style={{ flexDirection: 'row', gap: 16 }}>
                                    {Array.from({ length: COLS }).map((_, i) => (
                                        <View key={i} style={{ flex: 1 }}>
                                            {r[i] ? <FadeIn index={ri * COLS + i}><CouponTicket o={r[i]} size="full" onPress={() => copyCode(r[i].code)} /></FadeIn> : null}
                                        </View>
                                    ))}
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

/* ---------------- Bestsellers ---------------- */
export function BestsellersScreen() {
    const space = useBottomSpace();   // room for the floating order bar, only while it is on screen
    const closedStyle = useClosedStyle();
    const { text, background } = useBrand();
    const name = useThemeStore((st) => st.theme.name);
    const cats = useMenuStore((st) => st.categories);
    const loaded = useMenuStore((st) => st.loaded);
    const list = useMemo(
        () => cats.flatMap((c) => c.items).filter((i) => i.isBestseller).sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0)),
        [cats],
    );
    useEffect(() => { if (!loaded) useMenuStore.getState().load(); }, []);

    return (
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <BackHeader title={tr('Bestsellers')} />
            <FlatList
                data={list} keyExtractor={(i) => i._id}
                ListHeaderComponent={<Text style={[s.sub, { color: text }]}>{tr('Most ordered at {name}', { name: name })}</Text>}
                ListEmptyComponent={<Text style={s.empty}>{tr('No bestsellers yet')}</Text>}
                renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                contentContainerStyle={{ paddingBottom: space }}
            />
            <CartBar />
            <BulkCartBar />
        </View>
    );
}

/* ---------------- Favourites ---------------- */
export function FavouritesScreen() {
    const desk = useCustomerDesktop();   // the desktop website (a wide browser): a grid of dishes. False in the phone app.
    const space = useBottomSpace();   // room for the floating order bar, only while it is on screen
    const closedStyle = useClosedStyle();
    const nav = useNavigation();
    const { primary, radius, text, background } = useBrand();
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

    const msg = (title, sub, btn) => (desk ? (
        <DeskPage>
            <DeskHeader title={tr('Favourites')} />
            <View style={s.center}>
                <Text style={[s.big, { color: text }]}>{title}</Text>
                {sub ? <Text style={s.empty}>{sub}</Text> : null}
                {btn}
            </View>
        </DeskPage>
    ) : (
        <View style={s.flex}>
            <BackHeader title={tr('Favourites')} />
            <View style={s.center}>
                <Text style={[s.big, { color: text }]}>{title}</Text>
                {sub ? <Text style={s.empty}>{sub}</Text> : null}
                {btn}
            </View>
        </View>
    ));

    if (!enabled) return msg('Favourites are not available', '');
    if (!user) {
        return msg('Log in to see your favourites', '', (
            <Pressable onPress={() => nav.navigate('Login')} style={[s.cta, { backgroundColor: primary, borderRadius: radius }]}>
                <Text numberOfLines={1} style={s.ctaTxt}>{tr('Log in')}</Text>
            </Pressable>
        ));
    }

    if (desk) {
        // the dishes he saved: a grid of equal cards, five across
        const COLS = 5;
        const rows = [];
        for (let i = 0; i < items.length; i += COLS) rows.push(items.slice(i, i + COLS));
        return (
            <View style={[{ flex: 1 }, closedStyle]}>
                <DeskPage>
                    <DeskHeader title={tr('Favourites')} subtitle={items.length ? tr('{favCount} saved', { favCount: items.length }) : tr('Dishes you love')} />
                    <View style={{ marginTop: 24 }}>
                        {state === 'loading' ? <ListShimmer count={3} />
                            : state === 'error' && !items.length ? (
                                <View style={{ alignItems: 'center', paddingVertical: 70 }}>
                                    <Ionicons name="cloud-offline-outline" size={42} color={text} style={{ opacity: 0.5 }} />
                                    <Text style={[s.empty, { paddingBottom: 6 }]}>{tr('Could not load favourites')}</Text>
                                    <DeskBtn kind="ghost" label={tr('Try again')} onPress={load} />
                                </View>
                            ) : !items.length ? (
                                <View style={{ alignItems: 'center', paddingVertical: 70 }}>
                                    <Ionicons name="heart-outline" size={54} color={primary} />
                                    <Text style={{ color: text, fontSize: 18, fontWeight: '800', marginTop: 14 }}>{tr('No favourites yet. Tap the heart on any dish.')}</Text>
                                    <View style={{ marginTop: 18 }}><DeskBtn label={tr('Browse the menu')} icon="restaurant-outline" onPress={() => nav.navigate('MainTabs')} /></View>
                                </View>
                            ) : (
                                <View style={{ gap: 16 }}>
                                    {rows.map((r, ri) => (
                                        <View key={ri} style={{ flexDirection: 'row', gap: 16 }}>
                                            {Array.from({ length: COLS }).map((_, ci) => <View key={ci} style={{ flex: 1 }}>{r[ci] ? <ItemCard item={r[ci]} variant="desk" /> : null}</View>)}
                                        </View>
                                    ))}
                                </View>
                            )}
                    </View>
                </DeskPage>
            </View>
        );
    }

    return (
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <BackHeader title={tr('Favourites')} />
            {state === 'loading' ? <ListShimmer count={2} />
                : state === 'error' && !items.length ? (
                    <View style={s.center}>
                        <Text style={s.empty}>{tr('Could not load favourites')}</Text>
                        <Pressable onPress={load}><Text style={[s.link, { color: primary }]}>{tr('Try again')}</Text></Pressable>
                    </View>
                ) : (
                    <FlatList
                        data={items} keyExtractor={(i) => i._id}
                        ListEmptyComponent={<Text style={s.empty}>{tr('No favourites yet. Tap the heart on any dish.')}</Text>}
                        renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                        contentContainerStyle={{ paddingTop: 8, paddingBottom: space }}
                    />
                )}
            <CartBar />
            <BulkCartBar />
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#FFFFFF' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
    empty: { fontSize: 14, color: '#8A8F98', textAlign: 'center', padding: 30 },
    link: { marginTop: 12, fontSize: 13, fontWeight: '700' },
    cta: { marginTop: 18, paddingHorizontal: 32, paddingVertical: 12 },
    ctaTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    sub: { fontSize: 12, color: '#8A8F98', paddingHorizontal: 16, paddingBottom: 14 },
    offer: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, padding: 14, marginBottom: 12 },
    oTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    code: { fontSize: 16, fontWeight: '800', letterSpacing: 1 },
    apply: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#FFFFFF' },
    applyTxt: { fontSize: 12, fontWeight: '800' },
    oDesc: { fontSize: 14, fontWeight: '600', marginTop: 6 },
    oMeta: { fontSize: 11, color: '#8A8F98', marginTop: 4 },
});