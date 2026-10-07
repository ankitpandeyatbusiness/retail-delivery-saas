// src/screens/ItemScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, Pressable, ScrollView, FlatList, TextInput, ActivityIndicator,
    KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, BackHeader } from '../components/ui/kit';
import { Pic, VegDot, Heart, Tile, showToast, closedText, tint } from '../components/ui/shop';
import { useHomeStore } from '../store/useHomeStore';
import { useMenuStore, useCartStore } from '../store/shopStores';
import { fetchProduct } from '../api/shopApi';

// pre-select defaults, and the first available options for required groups
function initSel(p) {
    const sel = {};
    (p.optionGroups || []).forEach((g) => {
        const avail = (g.options || []).filter((o) => o.isAvailable !== false);
        const min = g.min ?? 0;
        const max = g.max ?? 1;
        const ids = avail.filter((o) => o.isDefault).slice(0, max).map((o) => o.id);
        for (const o of avail) {
            if (ids.length >= min) break;
            if (!ids.includes(o.id)) ids.push(o.id);
        }
        sel[g.id] = ids;
    });
    return sel;
}

function Radio({ on }) {
    const { primary } = useBrand();
    return (
        <View style={[s.radio, { borderColor: on ? primary : '#BBBBBB' }]}>
            {on ? <View style={[s.radioDot, { backgroundColor: primary }]} /> : null}
        </View>
    );
}

function Check({ on }) {
    const { primary } = useBrand();
    return (
        <View style={[s.check, on ? { backgroundColor: primary, borderColor: primary } : { borderColor: '#BBBBBB' }]}>
            {on ? <Text style={s.tick}>✓</Text> : null}
        </View>
    );
}

function Group({ g, chosen, onPick }) {
    const { text } = useBrand();
    const min = g.min ?? 0;
    const max = g.max ?? 1;
    const radio = max === 1;
    const hint = min >= 1
        ? (radio ? 'Required · Choose 1' : `Required · Choose ${min === max ? max : `${min} to ${max}`}`)
        : (radio ? 'Optional' : `Optional · Up to ${max}`);
    return (
        <View style={s.group}>
            <Text style={[s.gName, { color: text }]}>{g.name}</Text>
            <Text style={s.gHint}>{hint}</Text>
            {(g.options || []).map((o) => {
                const off = o.isAvailable === false;
                const on = chosen.includes(o.id);
                return (
                    <Pressable key={o.id} onPress={() => onPick(g, o)} disabled={off} style={[s.opt, off && { opacity: 0.4 }]}>
                        {radio ? <Radio on={on} /> : <Check on={on} />}
                        <Text style={[s.optName, { color: text }]}>{o.name}{off ? ' (unavailable)' : ''}</Text>
                        {o.price ? <Text style={s.optPrice}>+₹{o.price}</Text> : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

export default function ItemScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { id } = useRoute().params || {};
    const { primary, radius, text } = useBrand();
    const full = useHomeStore((st) => st.full);
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const menuCats = useMenuStore((st) => st.categories);
    const scrollRef = useRef(null);

    const [p, setP] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | gone | error
    const [sel, setSel] = useState({});
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');

    const load = useCallback(async () => {
        setState('loading');
        try {
            const d = await fetchProduct(id);
            setP(d);
            setSel(initSel(d));
            setQty(1);
            setNote('');
            setState('ok');
            scrollRef.current?.scrollTo({ y: 0, animated: false });
        } catch (e) {
            setState(e?.response?.status === 404 ? 'gone' : 'error');
        }
    }, [id]);
    useEffect(() => { load(); }, [load]);

    const groups = p?.optionGroups || [];

    const unit = useMemo(() => {
        if (!p) return 0;
        let t = p.price;
        groups.forEach((g) => (sel[g.id] || []).forEach((oid) => {
            const o = (g.options || []).find((x) => x.id === oid);
            if (o) t += o.price || 0;
        }));
        return t;
    }, [p, sel]);

    const valid = groups.every((g) => (sel[g.id] || []).length >= (g.min ?? 0));

    const related = useMemo(() => {
        if (!p) return [];
        const cat = menuCats.find((c) => String(c._id) === String(p.categoryId));
        return (cat?.items || []).filter((i) => i._id !== p._id && i.isAvailable !== false).slice(0, 8);
    }, [menuCats, p]);

    const pick = (g, o) => {
        const min = g.min ?? 0;
        const max = g.max ?? 1;
        const cur = sel[g.id] || [];
        const has = cur.includes(o.id);
        if (max === 1) {
            if (has) { if (min < 1) setSel({ ...sel, [g.id]: [] }); return; }
            setSel({ ...sel, [g.id]: [o.id] });
            return;
        }
        if (has) { setSel({ ...sel, [g.id]: cur.filter((x) => x !== o.id) }); return; }
        if (cur.length >= max) { showToast(`Choose at most ${max} for ${g.name}`); return; }
        setSel({ ...sel, [g.id]: [...cur, o.id] });
    };

    const add = () => {
        const selections = [];
        const names = [];
        groups.forEach((g) => {
            const ids = sel[g.id] || [];
            if (!ids.length) return;
            selections.push({ groupId: g.id, optionIds: ids });
            ids.forEach((oid) => {
                const o = (g.options || []).find((x) => x.id === oid);
                if (o) names.push(o.name);
            });
        });
        useCartStore.getState().add({
            productId: p._id, name: p.name, image: p.image, isVeg: p.isVeg,
            price: unit, quantity: qty, selections, optionsText: names.join(', '),
            note: note.trim() || undefined,
        });
        showToast(`${p.name} added`);
        nav.goBack();
    };

    if (state === 'loading') {
        return (
            <View style={s.flex}>
                <BackHeader title="" />
                <ActivityIndicator style={{ marginTop: 60 }} color={primary} />
            </View>
        );
    }
    if (state !== 'ok') {
        return (
            <View style={s.flex}>
                <BackHeader title="" />
                <View style={s.center}>
                    <Text style={[s.big, { color: text }]}>{state === 'gone' ? 'Item not available' : 'Could not load this item'}</Text>
                    {state === 'error'
                        ? <Pressable onPress={load}><Text style={[s.link, { color: primary }]}>Try again</Text></Pressable>
                        : <Pressable onPress={() => nav.goBack()}><Text style={[s.link, { color: primary }]}>Go back</Text></Pressable>}
                </View>
            </View>
        );
    }

    const f = full.features;
    const rated = f.ratingBadge && p.rating > 0 && (p.ratingCount || 0) >= full.ratings.minCount;
    const bits = [];
    if (f.prepTime && p.prepTimeMin) bits.push(`${p.prepTimeMin} min`);
    if (f.serves && p.serves) bits.push(`Serves ${p.serves}`);
    if (f.calories && p.calories) bits.push(`${p.calories} kcal`);
    if (p.isBestseller) bits.push('Bestseller');
    if (p.isNewArrival) bits.push('New');
    const off = p.mrp > p.price ? Math.round(100 - (p.price * 100) / p.mrp) : 0;

    const open = full.restaurant.isOpen;
    const sold = p.isAvailable === false;
    let blocked = null;
    if (!open) blocked = closedText(full);
    else if (sold) blocked = 'Sold out';
    else if (!valid) blocked = 'Not available right now';
    const total = +(unit * qty).toFixed(2);

    return (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View>
                    <Pic item={p} style={s.hero} />
                    <Pressable onPress={() => nav.goBack()} style={[s.cb, { top: insets.top + 10, left: 14 }]}>
                        <Text style={s.cbTxt}>←</Text>
                    </Pressable>
                    <Pressable onPress={() => showToast('Link copied')} style={[s.cb, { top: insets.top + 10, right: f.favourites ? 60 : 14 }]}>
                        <Text style={s.cbTxt}>⤴</Text>
                    </Pressable>
                    {f.favourites ? <Heart item={p} style={{ top: insets.top + 10, right: 14, width: 38, height: 38, borderRadius: 19 }} /> : null}
                </View>

                <View style={s.body}>
                    <View style={s.nameRow}>
                        {showDot ? <VegDot isVeg={p.isVeg} /> : null}
                        <Text style={[s.name, { color: text }]}>{p.name}</Text>
                    </View>
                    <View style={s.metaRow}>
                        {rated ? <View style={s.rate}><Text style={s.rateTxt}>{Number(p.rating).toFixed(1)} ★</Text></View> : null}
                        {bits.length ? <Text style={s.meta}>{bits.join(' · ')}</Text> : null}
                    </View>
                    <View style={s.priceRow}>
                        <Text style={[s.price, { color: text }]}>₹{p.price}</Text>
                        {off ? <Text style={s.mrp}>₹{p.mrp}</Text> : null}
                        {off ? <Text style={s.off}>{off}% off</Text> : null}
                    </View>
                    {p.description ? <Text style={s.desc}>{p.description}</Text> : null}

                    {groups.map((g) => <Group key={g.id} g={g} chosen={sel[g.id] || []} onPick={pick} />)}

                    {f.specialInstructions ? (
                        <TextInput
                            value={note} onChangeText={setNote} maxLength={200}
                            placeholder="Special instructions (optional)" placeholderTextColor="#999999"
                            style={s.input}
                        />
                    ) : null}
                </View>

                {related.length ? (
                    <View style={{ marginTop: 8 }}>
                        <Text style={[s.sec, { color: text }]}>You might also like</Text>
                        <FlatList
                            horizontal data={related} showsHorizontalScrollIndicator={false}
                            keyExtractor={(i) => i._id} contentContainerStyle={s.strip}
                            ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                            renderItem={({ item }) => <Tile item={item} />}
                        />
                    </View>
                ) : null}
                <View style={{ height: 24 }} />
            </ScrollView>

            <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
                <View style={[s.qs, { borderColor: primary, borderRadius: radius }]}>
                    <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} hitSlop={8}><Text style={[s.qBtn, { color: primary }]}>−</Text></Pressable>
                    <Text style={[s.qNum, { color: primary }]}>{qty}</Text>
                    <Pressable onPress={() => setQty((q) => Math.min(20, q + 1))} hitSlop={8}><Text style={[s.qBtn, { color: primary }]}>+</Text></Pressable>
                </View>
                {blocked ? (
                    <View style={[s.addBtn, { backgroundColor: '#BBBBBB', borderRadius: radius }]}>
                        <Text style={s.addTxt} numberOfLines={1}>{blocked}</Text>
                    </View>
                ) : (
                    <Pressable onPress={add} style={[s.addBtn, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text style={s.addTxt} numberOfLines={1}>{full.labels.addButton} · ₹{total}</Text>
                    </Pressable>
                )}
            </View>
        </KeyboardAvoidingView>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#FFFFFF' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800' },
    link: { marginTop: 12, fontSize: 14, fontWeight: '700' },
    hero: { width: '100%', height: 250 },
    cb: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 4 },
    cbTxt: { fontSize: 18, color: '#1C1C1C' },
    body: { padding: 16 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { flex: 1, fontSize: 21, fontWeight: '800' },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    rate: { backgroundColor: '#1E8E3E', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, marginRight: 8 },
    rateTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
    meta: { fontSize: 12, color: '#777777' },
    priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    price: { fontSize: 19, fontWeight: '800' },
    mrp: { marginLeft: 8, fontSize: 13, color: '#999999', textDecorationLine: 'line-through' },
    off: { marginLeft: 8, fontSize: 12, fontWeight: '700', color: '#1E8E3E' },
    desc: { marginTop: 10, fontSize: 14, lineHeight: 21, color: '#555555' },
    group: { marginTop: 18 },
    gName: { fontSize: 15, fontWeight: '800' },
    gHint: { fontSize: 11, color: '#777777', marginTop: 2, marginBottom: 4 },
    opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
    optName: { flex: 1, fontSize: 14, marginLeft: 10 },
    optPrice: { fontSize: 13, color: '#555555' },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    tick: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', lineHeight: 15 },
    input: { marginTop: 18, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 10, padding: 11, fontSize: 14, color: '#1C1C1C' },
    sec: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, paddingBottom: 6 },
    strip: { paddingHorizontal: 16, paddingVertical: 8 },
    bottom: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5', backgroundColor: '#FFFFFF' },
    qs: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
    qBtn: { fontSize: 20, fontWeight: '800', paddingHorizontal: 4 },
    qNum: { fontSize: 15, fontWeight: '800', minWidth: 24, textAlign: 'center' },
    addBtn: { flex: 1, marginLeft: 12, paddingVertical: 14, alignItems: 'center', paddingHorizontal: 8 },
    addTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});