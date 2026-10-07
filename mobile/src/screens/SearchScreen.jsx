// src/screens/SearchScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator, StyleSheet, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../ui/kit';
import { ItemCard, Pic, CartBar } from '../ui/shop';
import { useHomeStore } from '../store/useHomeStore';
import { useMenuStore } from '../store/shopStores';
import { searchProducts } from '../api/shopApi';

function Poster({ item, w }) {
    const nav = useNavigation();
    const off = item.isAvailable === false;
    return (
        <Pressable
            onPress={() => nav.navigate('Item', { id: item._id })}
            style={[{ width: w, height: Math.round(w * 1.5), borderRadius: 12, overflow: 'hidden', marginBottom: 10 }, off && { opacity: 0.5 }]}
        >
            <Pic item={item} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} style={s.grad}>
                <Text numberOfLines={2} style={s.pn}>{item.name}</Text>
                <Text style={s.pp}>₹{item.price}</Text>
            </LinearGradient>
        </Pressable>
    );
}

export default function SearchScreen() {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const { primary, text, background } = useBrand();
    const emptyText = useHomeStore((st) => st.full.labels.emptySearch);
    const { categories, recommended, loaded, load: loadMenu } = useMenuStore();
    const inputRef = useRef(null);
    const reqId = useRef(0);

    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState('idle'); // idle | loading | ok | error
    const [more, setMore] = useState(false);

    const term = q.trim();
    const active = term.length >= 2;
    const pw = Math.floor((width - 32 - 20) / 3);

    useEffect(() => { if (!loaded) loadMenu(); }, []);

    // open the keyboard when the tab is shown
    useFocusEffect(useCallback(() => {
        const t = setTimeout(() => inputRef.current?.focus(), 200);
        return () => clearTimeout(t);
    }, []));

    const popular = useMemo(() => {
        const seen = new Set();
        const out = [];
        [...recommended, ...categories.flatMap((c) => c.items)].forEach((i) => {
            if (!seen.has(i._id)) { seen.add(i._id); out.push(i); }
        });
        return out.slice(0, 9);
    }, [categories, recommended]);

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
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 100 }}>
                {term.length === 1 ? <Text style={s.hint}>Type at least 2 letters</Text> : null}
                <Text style={[s.sec, { color: text }]}>Popular right now</Text>
                {!loaded && !popular.length ? <ActivityIndicator style={{ margin: 30 }} color={primary} /> : (
                    <View style={s.grid}>
                        {popular.map((i, k) => (
                            <View key={i._id} style={{ marginRight: k % 3 === 2 ? 0 : 10 }}><Poster item={i} w={pw} /></View>
                        ))}
                    </View>
                )}
            </ScrollView>
        );
    } else if (state === 'loading') {
        body = <ActivityIndicator style={{ margin: 40 }} color={primary} />;
    } else if (state === 'error') {
        body = (
            <View style={s.center}>
                <Text style={s.emptyTxt}>Could not search. Check your connection.</Text>
                <Pressable onPress={() => setQ((x) => `${x} `)}><Text style={[s.link, { color: primary }]}>Try again</Text></Pressable>
            </View>
        );
    } else if (!res.length) {
        body = <View style={s.center}><Text style={s.emptyTxt}>{emptyText}</Text></View>;
    } else {
        body = (
            <FlatList
                data={res} keyExtractor={(i) => i._id} keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => <ItemCard item={item} variant="compact" />}
                onEndReached={loadMore} onEndReachedThreshold={0.4}
                ListFooterComponent={more ? <ActivityIndicator style={{ margin: 16 }} color={primary} /> : null}
                contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 }}
            />
        );
    }

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <View style={s.bar}>
                <View style={s.box}>
                    <Text>🔍</Text>
                    <TextInput
                        ref={inputRef} value={q} onChangeText={setQ} placeholder="Search dishes"
                        placeholderTextColor="#777777" returnKeyType="search" autoCorrect={false} style={s.input}
                    />
                    {q ? <Pressable onPress={() => setQ('')} hitSlop={10}><Text style={s.x}>✕</Text></Pressable> : null}
                </View>
            </View>
            {body}
            <CartBar />
        </View>
    );
}

const s = StyleSheet.create({
    bar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    box: { flexDirection: 'row', alignItems: 'center', height: 46, borderWidth: 1, borderColor: '#E3E3E3', borderRadius: 14, paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
    input: { flex: 1, fontSize: 14, marginLeft: 8, color: '#1C1C1C', paddingVertical: 0 },
    x: { fontSize: 15, color: '#777777', paddingLeft: 8 },
    hint: { fontSize: 12, color: '#777777', paddingHorizontal: 16, paddingTop: 6 },
    sec: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
    grad: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 7, paddingTop: 24, paddingBottom: 7 },
    pn: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
    pp: { color: '#FFFFFF', fontSize: 11, marginTop: 2 },
    center: { padding: 40, alignItems: 'center' },
    emptyTxt: { fontSize: 14, color: '#777777', textAlign: 'center' },
    link: { marginTop: 12, fontSize: 13, fontWeight: '700' },
});