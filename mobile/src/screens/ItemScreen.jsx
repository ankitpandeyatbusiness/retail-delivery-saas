// src/screens/ItemScreen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, Pressable, FlatList, Share, KeyboardAvoidingView, Platform, StyleSheet,
    Animated, Easing, LayoutAnimation, UIManager,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../components/ui/kit';
import { Pic, VegDot, Heart, Tile, showToast, closedText, tint } from '../components/ui/shop';
import { Press, Appear, ease } from '../components/ui/cartParts';
import SlideNum from '../components/ui/SlideNum';
import { useHomeStore } from '../store/useHomeStore';
import { useMenuStore, useCartStore } from '../store/shopStores';
import { fetchProduct } from '../api/shopApi';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// same options picked = same cart line
const sigOf = (sels) => (sels || []).map((x) => `${x.groupId}:${[...(x.optionIds || [])].sort().join(',')}`).sort().join('|');

function Skeleton() {
    const { border, background } = useBrand();
    const v = useRef(new Animated.Value(0.45)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);
    const bar = (w, h, mt) => <View style={{ width: w, height: h, borderRadius: 8, backgroundColor: border, marginTop: mt }} />;
    return (
        <Animated.View style={{ flex: 1, opacity: v, backgroundColor: background }}>
            <View style={{ height: 250, backgroundColor: border }} />
            <View style={{ padding: 16 }}>
                {bar('70%', 24, 0)}{bar('40%', 14, 14)}{bar('30%', 22, 14)}{bar('100%', 14, 20)}{bar('90%', 14, 8)}
            </View>
        </Animated.View>
    );
}

function Mark({ on, radio }) {
    const { primary } = useBrand();
    const v = useRef(new Animated.Value(on ? 1 : 0)).current;
    useEffect(() => {
        Animated.spring(v, { toValue: on ? 1 : 0, friction: 6, tension: 170, useNativeDriver: true }).start();
    }, [on]);
    return (
        <View style={[s.mark, radio ? s.markR : s.markC, { borderColor: on ? primary : '#BBBBBB', backgroundColor: !radio && on ? primary : 'transparent' }]}>
            <Animated.View style={{ opacity: v, transform: [{ scale: v }] }}>
                {radio ? <View style={[s.dot, { backgroundColor: primary }]} /> : <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
            </Animated.View>
        </View>
    );
}

function Group({ g, chosen, onPick, index }) {
    const { text, muted, surface, border, primary, error } = useBrand();
    const min = g.min ?? 0;
    const max = g.max ?? 1;
    const radio = max === 1;
    const done = chosen.length >= min;
    const hint = min >= 1
        ? (radio ? 'Choose 1' : `Choose ${min === max ? max : `${min} to ${max}`}`)
        : (radio ? 'Optional' : `Optional · Up to ${max}`);
    return (
        <Appear delay={80 + index * 60} style={[s.group, { backgroundColor: surface, borderColor: border }]}>
            <View style={s.gHead}>
                <View style={{ flex: 1 }}>
                    <Text style={[s.gName, { color: text }]}>{g.name}</Text>
                    <Text style={[s.gHint, { color: muted }]}>{hint}</Text>
                </View>
                {min >= 1 ? (
                    <View style={[s.req, { backgroundColor: tint(done ? '#1E8E3E' : error) }]}>
                        {done ? <Ionicons name="checkmark" size={11} color="#1E8E3E" style={{ marginRight: 3 }} /> : null}
                        <Text style={[s.reqTxt, { color: done ? '#1E8E3E' : error }]}>{done ? 'DONE' : 'REQUIRED'}</Text>
                    </View>
                ) : null}
            </View>
            {(g.options || []).map((o) => {
                const off = o.isAvailable === false;
                const on = chosen.includes(o.id);
                return (
                    <Press key={o.id} onPress={() => onPick(g, o)} disabled={off}
                        style={[s.opt, { borderBottomColor: border, backgroundColor: on ? tint(primary) : 'transparent' }, off && { opacity: 0.4 }]}>
                        <Mark on={on} radio={radio} />
                        <Text style={[s.optName, { color: text, fontWeight: on ? '800' : '600' }]}>{o.name}{off ? ' (unavailable)' : ''}</Text>
                        {o.price ? <Text style={[s.optPrice, { color: muted }]}>+₹{o.price}</Text> : null}
                    </Press>
                );
            })}
        </Appear>
    );
}



export default function ItemScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { id } = useRoute().params || {};
    const { primary, radius, text, muted, background, surface, border } = useBrand();
    const full = useHomeStore((st) => st.full);
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const menuCats = useMenuStore((st) => st.categories);
    const lines = useCartStore((st) => st.lines);
    const scrollRef = useRef(null);
    const scrollY = useRef(new Animated.Value(0)).current;
    const bump = useRef(new Animated.Value(1)).current;
    const btn = useRef(new Animated.Value(0)).current;

    const [p, setP] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | gone | error
    const [sel, setSel] = useState({});
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');
    const [more, setMore] = useState(false);
    const [added, setAdded] = useState(false);

    const load = useCallback(async () => {
        setState('loading');
        try {
            const d = await fetchProduct(id);
            const inCart = useCartStore.getState().lines.find((l) => String(l.productId) === String(d._id));
            const base = initSel(d);
            if (inCart) (inCart.selections || []).forEach((x) => { base[x.groupId] = x.optionIds; });
            setP(d); setSel(base); setQty(inCart ? inCart.quantity : 1); setNote(''); setMore(false); setAdded(false);
            setState('ok');
            scrollRef.current?.getNode?.().scrollTo?.({ y: 0, animated: false });
            scrollRef.current?.scrollTo?.({ y: 0, animated: false });
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
    const curSig = sigOf(groups.filter((g) => (sel[g.id] || []).length).map((g) => ({ groupId: g.id, optionIds: sel[g.id] })));
    const existing = p ? lines.find((l) => String(l.productId) === String(p._id) && sigOf(l.selections) === curSig) : null;

    const related = useMemo(() => {
        if (!p) return [];
        const cat = menuCats.find((c) => String(c._id) === String(p.categoryId));
        return (cat?.items || []).filter((i) => i._id !== p._id && i.isAvailable !== false).slice(0, 8);
    }, [menuCats, p]);

    let blocked = null;
    if (p) {
        if (!full.restaurant.isOpen) blocked = closedText(full);
        else if (p.isAvailable === false) blocked = 'Sold out';
        else if (!valid) blocked = 'Not available right now';
    }
    const total = +(unit * qty).toFixed(2);

    useEffect(() => {
        Animated.timing(btn, { toValue: blocked ? 0 : 1, duration: 250, useNativeDriver: false }).start();
    }, [!!blocked]);
    useEffect(() => {
        bump.setValue(1.1);
        Animated.spring(bump, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();
    }, [total]);

    const pick = (g, o) => {
        const min = g.min ?? 0;
        const max = g.max ?? 1;
        const cur = sel[g.id] || [];
        const has = cur.includes(o.id);
        ease();
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
        if (added) return;
        if (existing) {
            useCartStore.getState().setQty(existing.key, qty);
            setAdded(true);
            setTimeout(() => nav.replace('Cart'), 450);
            return;
        }
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
        setAdded(true);
        setTimeout(() => nav.replace('Cart'), 450);
    };

    const share = async () => {
        try {
            await Share.share({
                title: p?.name,
                message: `${p?.name} · ₹${p?.price}\nOrder it from ${full.restaurant?.name || 'our shop'}!`,
            });
        } catch (e) {
            showToast('Could not open share');
        }
    };

    if (state === 'loading') {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <Skeleton />
                <View style={[s.cbWrap, { top: insets.top + 8, left: 14 }]}>
                    <Press onPress={() => nav.goBack()} style={s.cb}><Ionicons name="arrow-back" size={20} color="#1C1C1C" /></Press>
                </View>
            </View>
        );
    }
    if (state !== 'ok') {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <BackHeader title="" />
                <Appear style={s.center}>
                    <View style={[s.errIcon, { backgroundColor: surface, borderColor: border }]}>
                        <Ionicons name={state === 'gone' ? 'fast-food-outline' : 'cloud-offline-outline'} size={40} color={muted} />
                    </View>
                    <Text style={[s.big, { color: text }]}>{state === 'gone' ? 'Item not available' : 'Could not load this item'}</Text>
                    <Press onPress={state === 'error' ? load : () => nav.goBack()} style={[s.retry, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text style={s.retryTxt}>{state === 'error' ? 'Try again' : 'Go back'}</Text>
                    </Press>
                </Appear>
            </View>
        );
    }

    const f = full.features;
    const rated = f.ratingBadge && p.rating > 0 && (p.ratingCount || 0) >= full.ratings.minCount;
    const chips = [];
    if (f.prepTime && p.prepTimeMin) chips.push({ i: 'time-outline', t: `${p.prepTimeMin} min` });
    if (f.serves && p.serves) chips.push({ i: 'people-outline', t: `Serves ${p.serves}` });
    if (f.calories && p.calories) chips.push({ i: 'flame-outline', t: `${p.calories} kcal` });
    if (p.isBestseller) chips.push({ i: 'ribbon-outline', t: 'Bestseller' });
    if (p.isNewArrival) chips.push({ i: 'sparkles-outline', t: 'New' });
    const off = p.mrp > p.price ? Math.round(100 - (p.price * 100) / p.mrp) : 0;
    const longDesc = (p.description || '').length > 110;

    const heroY = scrollY.interpolate({ inputRange: [-250, 0, 250], outputRange: [-125, 0, 110], extrapolate: 'clamp' });
    const heroS = scrollY.interpolate({ inputRange: [-250, 0], outputRange: [2, 1], extrapolateRight: 'clamp' });
    const barOp = scrollY.interpolate({ inputRange: [140, 210], outputRange: [0, 1], extrapolate: 'clamp' });
    const btnBg = btn.interpolate({ inputRange: [0, 1], outputRange: ['#BBBBBB', primary] });

    return (
        <KeyboardAvoidingView style={[s.flex, { backgroundColor: background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Animated.ScrollView
                ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
            >
                <Animated.View style={{ transform: [{ translateY: heroY }, { scale: heroS }] }}>
                    <Pic item={p} style={s.hero} />
                    <View pointerEvents="none" style={s.scrim} />
                </Animated.View>

                <View style={[s.body, { backgroundColor: background }]}>
                    <Appear>
                        <View style={s.nameRow}>
                            {showDot ? <View style={{ marginRight: 8 }}><VegDot isVeg={p.isVeg} /></View> : null}
                            <Text style={[s.name, { color: text }]}>{p.name}</Text>
                        </View>
                        <View style={s.chipRow}>
                            {rated ? (
                                <View style={s.rate}>
                                    <Text style={s.rateTxt}>{Number(p.rating).toFixed(1)}</Text>
                                    <Ionicons name="star" size={10} color="#FFFFFF" style={{ marginLeft: 3 }} />
                                </View>
                            ) : null}
                            {chips.map((c) => (
                                <View key={c.t} style={[s.mchip, { backgroundColor: surface, borderColor: border }]}>
                                    <Ionicons name={c.i} size={12} color={muted} style={{ marginRight: 4 }} />
                                    <Text style={[s.mchipTxt, { color: muted }]}>{c.t}</Text>
                                </View>
                            ))}
                        </View>
                        <View style={s.priceRow}>
                            <Text style={[s.price, { color: text }]}>₹{p.price}</Text>
                            {off ? <Text style={s.mrp}>₹{p.mrp}</Text> : null}
                            {off ? <View style={s.offBadge}><Text style={s.offTxt}>{off}% OFF</Text></View> : null}
                        </View>
                        {p.description ? (
                            <Pressable onPress={() => { if (longDesc) { ease(); setMore((m) => !m); } }}>
                                <Text style={[s.desc, { color: muted }]} numberOfLines={more || !longDesc ? undefined : 3}>{p.description}</Text>
                                {longDesc ? <Text style={[s.more, { color: primary }]}>{more ? 'Show less' : 'Read more'}</Text> : null}
                            </Pressable>
                        ) : null}
                    </Appear>

                    {groups.map((g, i) => <Group key={g.id} g={g} index={i} chosen={sel[g.id] || []} onPick={pick} />)}

                </View>

                {related.length ? (
                    <Appear delay={160} style={{ marginTop: 8, backgroundColor: background }}>
                        <Text style={[s.sec, { color: text }]}>You might also like</Text>
                        <FlatList
                            horizontal data={related} showsHorizontalScrollIndicator={false}
                            keyExtractor={(i) => i._id} contentContainerStyle={s.strip}
                            ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                            renderItem={({ item }) => <Tile item={item} />}
                        />
                    </Appear>
                ) : null}
                <View style={{ height: 24, backgroundColor: background }} />
            </Animated.ScrollView>

            {/* top bar fades in after scrolling */}
            <Animated.View pointerEvents="none" style={[s.bar, { height: insets.top + 56, paddingTop: insets.top, backgroundColor: background, borderBottomColor: border, opacity: barOp }]}>
                <Text numberOfLines={1} style={[s.barTxt, { color: text }]}>{p.name}</Text>
            </Animated.View>
            <View style={[s.cbWrap, { top: insets.top + 8, left: 14 }]}>
                <Press onPress={() => nav.goBack()} style={s.cb}><Ionicons name="arrow-back" size={20} color="#1C1C1C" /></Press>
            </View>
            <View style={[s.cbWrap, { top: insets.top + 8, right: f.favourites ? 60 : 14 }]}>
                <Press onPress={share} style={s.cb}><Ionicons name="share-social-outline" size={19} color="#1C1C1C" /></Press>
            </View>
            {f.favourites ? <Heart item={p} style={{ top: insets.top + 8, right: 14, width: 38, height: 38, borderRadius: 19, zIndex: 20 }} /> : null}

            <Appear style={[s.bottom, { paddingBottom: insets.bottom + 12, backgroundColor: surface, borderTopColor: border }]}>
                <View style={[s.qs, { borderColor: primary, borderRadius: radius, backgroundColor: tint(primary) }]}>
                    <Press onPress={() => setQty((q) => Math.max(1, q - 1))} hitSlop={8}><Text style={[s.qBtn, { color: primary }]}>−</Text></Press>
                    <SlideNum value={qty} style={[s.qNum, { color: primary }]} />
                    <Press onPress={() => setQty((q) => Math.min(20, q + 1))} hitSlop={8}><Text style={[s.qBtn, { color: primary }]}>+</Text></Press>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Press onPress={blocked ? undefined : add} disabled={!!blocked}>
                        <Animated.View style={[s.addBtn, { backgroundColor: added ? '#1E8E3E' : btnBg, borderRadius: radius }]}>
                            {added ? (
                                <View style={s.addRow}><Ionicons name="checkmark-circle" size={18} color="#FFFFFF" /><Text style={[s.addTxt, { marginLeft: 6 }]}>Added</Text></View>
                            ) : blocked ? <Text style={s.addTxt} numberOfLines={1}>{blocked}</Text> : (
                                <View style={s.addRow}>
                                    <Text style={s.addTxt} numberOfLines={1}>{existing ? 'Update' : full.labels.addButton}</Text>
                                    <Animated.Text style={[s.addTxt, { marginLeft: 8, transform: [{ scale: bump }] }]}>· ₹{total}</Animated.Text>
                                </View>
                            )}
                        </Animated.View>
                    </Press>
                </View>
            </Appear>
        </KeyboardAvoidingView>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800' },
    errIcon: { width: 90, height: 90, borderRadius: 45, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    retry: { marginTop: 18, paddingHorizontal: 28, paddingVertical: 12 },
    retryTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    hero: { width: '100%', height: 270 },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.12)' },
    cbWrap: { position: 'absolute', zIndex: 20 },
    cb: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, justifyContent: 'center', paddingHorizontal: 66, borderBottomWidth: StyleSheet.hairlineWidth, elevation: 6 },
    barTxt: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
    body: { marginTop: -26, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingTop: 22 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { flex: 1, fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10 },
    rate: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E8E3E', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4, marginRight: 8, marginBottom: 6 },
    rateTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    mchip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, marginRight: 8, marginBottom: 6 },
    mchipTxt: { fontSize: 12, fontWeight: '700' },
    priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    price: { fontSize: 22, fontWeight: '900' },
    mrp: { marginLeft: 10, fontSize: 14, color: '#999999', textDecorationLine: 'line-through' },
    offBadge: { marginLeft: 10, backgroundColor: '#E6F4EA', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
    offTxt: { fontSize: 11, fontWeight: '900', color: '#1E8E3E' },
    desc: { marginTop: 12, fontSize: 14, lineHeight: 21 },
    more: { marginTop: 4, fontSize: 13, fontWeight: '800' },
    group: { marginTop: 16, borderWidth: 1, borderRadius: 16, padding: 14, overflow: 'hidden' },
    gHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    gName: { fontSize: 15, fontWeight: '900' },
    gHint: { fontSize: 11, marginTop: 2, fontWeight: '600' },
    req: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
    reqTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
    opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
    optName: { flex: 1, fontSize: 14, marginLeft: 12 },
    optPrice: { fontSize: 13, fontWeight: '700' },
    mark: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    markR: { borderRadius: 11 },
    markC: { borderRadius: 6 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    note: { flexDirection: 'row', alignItems: 'center', marginTop: 16, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14 },
    noteIn: { flex: 1, fontSize: 14, fontWeight: '600', paddingVertical: 14, marginLeft: 10 },
    sec: { fontSize: 17, fontWeight: '900', paddingHorizontal: 18, paddingBottom: 6, paddingTop: 8 },
    strip: { paddingHorizontal: 18, paddingVertical: 8 },
    bottom: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, elevation: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: -4 } },
    qs: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
    qBtn: { fontSize: 20, fontWeight: '800', paddingHorizontal: 6 },
    qNum: { fontSize: 15, fontWeight: '900', minWidth: 26, textAlign: 'center' },
    addBtn: { paddingVertical: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, minHeight: 50 },
    addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    addTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});