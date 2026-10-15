// src/screens/SearchScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator, Keyboard, StyleSheet, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../../components/common/kit';
import { ItemCard, Pic, CartBar, AddButton, VegDot, quickAdd } from '../../components/customers/shop';
import { Slider, VegSwitch, Cats, FiltersRow, Fade, useVoice, VoiceOverlay } from '../../components/customers/finder';
import FilterDialog from './FilterDialog';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useMenuStore } from '../../store/customers/shopStores';
import { useFilterStore, applyFilters } from '../../store/customers/useFilterStore';
import { searchProducts } from '../../api/customers/shopApi';
import { readCache, writeCache } from '../../utils/common/cache';
import { FadeIn } from '../../components/common/motion';
import { SkelDish } from '../../components/customers/skeletons';

// Popular card: photo, name, price and the ADD / − 1 + pill, so dishes can be added straight from here.
function Poster({ item, w }) {
    const nav = useNavigation();
    const { text, muted } = useBrand();
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const off = item.isAvailable === false;
    return (
        <Pressable
            onPress={() => nav.navigate('Item', { id: item._id })}
            style={[{ width: w, marginBottom: 14 }, off && { opacity: 0.5 }]}
        >
            <View>
                <Pic item={item} style={{ width: w, height: Math.round(w * 0.78), borderRadius: 14 }} />
                <AddButton item={item} kind="overlap" onPress={() => quickAdd(item, nav)} style={s.posAdd} />
            </View>
            <View style={{ paddingTop: 22 }}>
                <View style={s.nameRow}>
                    {showDot ? <VegDot isVeg={item.isVeg} /> : null}
                    <Text numberOfLines={1} style={[s.pn, { color: text }]}>{item.name}</Text>
                </View>
                <View style={s.priceRow}>
                    <Text style={[s.pp, { color: text }]}>₹{item.price}</Text>
                    {item.mrp > item.price ? <Text style={[s.mrp, { color: muted }]}>₹{item.mrp}</Text> : null}
                </View>
            </View>
        </Pressable>
    );
}

export default function SearchScreen() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const route = useRoute();
    const { width } = useWindowDimensions();
    const { primary, text, background, surface, border, muted } = useBrand();
    const full = useHomeStore((st) => st.full);
    const foodMode = useHomeStore((st) => st.config.foodMode);
    const emptyText = full.labels.emptySearch;
    const minCount = full.ratings.minCount;
    const { categories, recommended, loaded, load: loadMenu } = useMenuStore();
    const f = useFilterStore();
    const veg = f.active.includes('veg_only');
    const inputRef = useRef(null);
    const reqId = useRef(0);
    const fromVoice = useRef(false);

    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState('idle'); // idle | loading | ok | error
    const [more, setMore] = useState(false);
    const [dlg, setDlg] = useState(false);
    const [recent, setRecent] = useState([]);
    useEffect(() => { readCache('recentSearches').then((v) => { if (Array.isArray(v)) setRecent(v.slice(0, 8)); }); }, []);
    const saveRecent = (list) => { setRecent(list); writeCache('recentSearches', list); };
    const remember = (t) => {
        const w = String(t || '').trim();
        if (w.length < 2) return;
        saveRecent([w, ...recent.filter((x) => x.toLowerCase() !== w.toLowerCase())].slice(0, 8));
    };

    const term = q.trim();
    const active = term.length >= 2;
    const pw = Math.floor((width - 32 - 12) / 2);

    const voice = useVoice((t) => setQ(t));
    const mic = () => { Keyboard.dismiss(); voice.start(); };

    useEffect(() => { if (!loaded) loadMenu(); }, []);

    // spoken text coming from the Home screen mic
    useEffect(() => {
        const v = route.params?.voice;
        if (v) { fromVoice.current = true; setQ(v); }
    }, [route.params?.n]);

    // The keyboard no longer opens by itself: the page opens calm (popular dishes first) and the keyboard comes
    // up only when the customer taps the search bar.
    useFocusEffect(useCallback(() => {
        fromVoice.current = false;
        return undefined;
    }, []));

    const all = useMemo(() => categories.flatMap((c) => c.items), [categories]);
    const names = useMemo(
        () => [...all].sort((a, b) => (b.isBestseller ? 1 : 0) - (a.isBestseller ? 1 : 0)).slice(0, 4).map((i) => i.name),
        [all],
    );

    const fKey = [f.categories, f.active, f.sort, f.price, f.spice, f.serves, f.weight];

    const popular = useMemo(() => {
        const seen = new Set();
        const out = [];
        [...recommended, ...all].forEach((i) => {
            if (!seen.has(i._id)) { seen.add(i._id); out.push(i); }
        });
        return applyFilters(out, f, minCount).slice(0, 8);
    }, [all, recommended, minCount, ...fKey]);

    const shown = useMemo(() => applyFilters(res, f, minCount), [res, minCount, ...fKey]);

    // 2+ letters, 350 ms after the last key
    useEffect(() => {
        if (!active) { reqId.current += 1; setState('idle'); setRes([]); return undefined; }
        setState('loading');
        const id = ++reqId.current;
        const t = setTimeout(async () => {
            try {
                const r = await searchProducts({ q: term, page: 1, limit: 20 });
                if (id !== reqId.current) return;
                setRes(r.items || []);
                setPage(1);
                setHasMore(!!r.hasMore);
                setState('ok');
            } catch (e) {
                if (id === reqId.current) setState('error');
            }
        }, 350);
        return () => clearTimeout(t);
    }, [term]);

    const loadMore = async () => {
        if (more || !hasMore || state !== 'ok') return;
        setMore(true);
        const id = reqId.current;
        try {
            const r = await searchProducts({ q: term, page: page + 1, limit: 20 });
            if (id !== reqId.current) return;
            setRes((p) => [...p, ...(r.items || [])]);
            setPage(page + 1);
            setHasMore(!!r.hasMore);
        } catch (e) { /* keep what we have */ } finally { setMore(false); }
    };

    let body;
    if (!active) {
        body = (
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 110 }}>
                {term.length === 1 ? <Text style={[s.hint, { color: muted }]}>Type at least 2 letters</Text> : null}
                {recent.length && !term ? (
                    <FadeIn>
                        <View style={s.recHead}>
                            <Text style={[s.sec, { color: text, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Recent searches</Text>
                            <Pressable onPress={() => saveRecent([])} hitSlop={8}><Text style={[s.link, { color: primary, marginTop: 0 }]}>Clear</Text></Pressable>
                        </View>
                        <View style={s.recWrap}>
                            {recent.map((r) => (
                                <Pressable key={r} onPress={() => setQ(r)} style={[s.recChip, { backgroundColor: surface, borderColor: border }]}>
                                    <Ionicons name="time-outline" size={14} color={muted} />
                                    <Text style={[s.recTxt, { color: text }]} numberOfLines={1}>{r}</Text>
                                    <Pressable onPress={() => saveRecent(recent.filter((x) => x !== r))} hitSlop={8}>
                                        <Ionicons name="close" size={14} color={muted} />
                                    </Pressable>
                                </Pressable>
                            ))}
                        </View>
                    </FadeIn>
                ) : null}
                <Text style={[s.sec, { color: text }]}>Popular right now</Text>
                {!loaded && !popular.length ? <ActivityIndicator style={{ margin: 30 }} color={primary} /> : !popular.length ? (
                    <Text style={[s.emptyTxt, { color: muted, marginTop: 20 }]}>{emptyText}</Text>
                ) : (
                    <View style={s.grid}>
                        {popular.map((i, k) => (
                            <View key={i._id} style={{ marginRight: k % 2 === 1 ? 0 : 12 }}><Poster item={i} w={pw} /></View>
                        ))}
                    </View>
                )}
            </ScrollView>
        );
    } else if (state === 'loading') {
        body = (
            <View style={{ paddingTop: 12 }}>
                {[0, 1, 2, 3].map((i) => <SkelDish key={i} variant="compact" />)}
            </View>
        );
    } else if (state === 'error') {
        body = (
            <View style={s.center}>
                <Text style={[s.emptyTxt, { color: muted }]}>Could not search. Check your connection.</Text>
                <Pressable onPress={() => setQ((x) => `${x} `)}><Text style={[s.link, { color: primary }]}>Try again</Text></Pressable>
            </View>
        );
    } else if (!shown.length) {
        body = (
            <FadeIn style={s.center}>
                <View style={[s.emptyIc, { backgroundColor: surface, borderColor: border }]}>
                    <Ionicons name="search-outline" size={34} color={muted} />
                </View>
                <Text style={[s.emptyHead, { color: text }]}>{emptyText}</Text>
                <Text style={[s.emptyTxt, { color: muted, marginTop: 6 }]}>Check the spelling or try a shorter word.</Text>
            </FadeIn>
        );
    } else {
        body = (
            <FlatList
                data={shown} keyExtractor={(i) => i._id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
                renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                onEndReached={loadMore} onEndReachedThreshold={0.4}
                ListFooterComponent={more ? <ActivityIndicator style={{ margin: 16 }} color={primary} /> : null}
                contentContainerStyle={{ paddingTop: 8, paddingBottom: 110 }}
            />
        );
    }

    const fadeKey = !active ? 'idle' : state;

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <View style={[s.head, { backgroundColor: background, borderBottomColor: border }]}>
                <View style={s.searchRow}>
                    <View style={[s.sb, { backgroundColor: surface, borderColor: border }]}>
                        <Ionicons name="search" size={18} color={primary} />
                        <View style={s.inWrap}>
                            {!q ? <View pointerEvents="none" style={s.phLayer}><Slider names={names} /></View> : null}
                            <TextInput
                                ref={inputRef} value={q} onChangeText={setQ}
                                onSubmitEditing={() => remember(q)} onBlur={() => remember(q)}
                                returnKeyType="search" autoCorrect={false}
                                style={[s.input, { color: text }]}
                            />
                        </View>
                        {q ? (
                            <Pressable onPress={() => setQ('')} hitSlop={8} style={{ marginRight: 10 }}>
                                <Ionicons name="close-circle" size={18} color={muted} />
                            </Pressable>
                        ) : null}
                        <Pressable onPress={mic} hitSlop={8}>
                            <Ionicons name="mic-outline" size={19} color={muted} />
                        </Pressable>
                    </View>
                    {full.features.vegToggle && foodMode === 'mixed' ? <VegSwitch on={veg} onPress={() => f.toggleFilter('veg_only')} /> : null}
                </View>
                <Cats />
                <FiltersRow onOpen={() => setDlg(true)} />
            </View>
            <Fade k={fadeKey}>{body}</Fade>
            <CartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
            <VoiceOverlay on={voice.on} txt={voice.txt} onStop={voice.stop} />
        </View>
    );
}

const s = StyleSheet.create({
    head: { borderBottomWidth: StyleSheet.hairlineWidth, elevation: 3, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
    sb: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 48, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
    inWrap: { flex: 1, height: 44, justifyContent: 'center', marginLeft: 10 },
    phLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, fontSize: 14, paddingVertical: 0 },
    hint: { fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
    sec: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
    posAdd: { position: 'absolute', bottom: -17, alignSelf: 'center' },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    pn: { flex: 1, fontSize: 13, fontWeight: '700' },
    priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    pp: { fontSize: 14, fontWeight: '800' },
    mrp: { marginLeft: 6, fontSize: 12, textDecorationLine: 'line-through' },
    center: { padding: 40, alignItems: 'center' },
    recHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 },
    recWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 10 },
    recChip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, maxWidth: '100%' },
    recTxt: { fontSize: 13, fontWeight: '700', marginHorizontal: 6, flexShrink: 1 },
    emptyIc: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    emptyHead: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
    emptyTxt: { fontSize: 14, textAlign: 'center' },
    link: { marginTop: 12, fontSize: 13, fontWeight: '700' },
});