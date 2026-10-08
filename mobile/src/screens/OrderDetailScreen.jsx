// src/screens/OrderDetailScreen.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, TextInput, StyleSheet, Animated, Easing } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, BackHeader } from '../components/ui/kit';
import { showToast, tint } from '../components/ui/shop';
import { Press, Appear } from '../components/ui/cartParts';
import { StatusPill, isActive, rs, errMsg, cancelFlow, reorder } from '../components/ui/orders';
import { viewInvoice, saveInvoice } from '../components/ui/invoice';
import { useHomeStore } from '../store/useHomeStore';
import { fetchOrder, rateOrder, fetchRatings } from '../api/shopApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FLOW_DELIVERY = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
const FLOW_OTHER = ['placed', 'accepted', 'preparing', 'ready', 'delivered'];
const STEP = {
    placed: 'Order placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup',
    out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};
const ICON = {
    placed: 'receipt-outline', accepted: 'checkmark-done-outline', preparing: 'restaurant-outline', ready: 'bag-check-outline',
    out_for_delivery: 'bicycle-outline', delivered: 'checkmark-circle-outline', cancelled: 'close-circle-outline',
};
const WHO = { customer: 'you', shop: 'the shop', admin: 'admin', system: 'system' };
const PAY = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', wallet: 'Wallet' };
const WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

const tm = (v) => { const d = new Date(v); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmt = (v) => { const d = new Date(v); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${tm(v)}`; };
const addr = (a) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');

function Card({ title, icon, delay = 0, children }) {
    const { primary, text, surface, border } = useBrand();
    return (
        <Appear delay={delay} style={[s.card, { backgroundColor: surface, borderColor: border }]}>
            {title ? (
                <View style={s.cHead}>
                    <Ionicons name={icon} size={17} color={primary} />
                    <Text style={[s.h, { color: text }]}>{title}</Text>
                </View>
            ) : null}
            {children}
        </Appear>
    );
}

function Row({ k, v, green, bold }) {
    const { text } = useBrand();
    const c = green ? '#1E8E3E' : text;
    return (
        <View style={s.bRow}>
            <Text style={[s.bK, bold && s.bold, { color: c }]}>{k}</Text>
            <Text style={[s.bK, bold && s.bold, { color: c }]}>{v}</Text>
        </View>
    );
}

function Step({ st, k, idx, last, hist, live }) {
    const { text, muted } = useBrand();
    const done = k <= idx;
    const cur = k === idx && live;
    const a = useRef(new Animated.Value(done ? 1 : 0)).current;
    const l = useRef(new Animated.Value(k < idx ? 1 : 0)).current;
    const ring = useRef(new Animated.Value(0)).current;
    useEffect(() => { Animated.timing(a, { toValue: done ? 1 : 0, duration: 350, useNativeDriver: false }).start(); }, [done]);
    useEffect(() => { Animated.timing(l, { toValue: k < idx ? 1 : 0, duration: 450, useNativeDriver: false }).start(); }, [idx]);
    useEffect(() => {
        if (!cur) { ring.setValue(0); return undefined; }
        const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [cur]);
    const dotBg = a.interpolate({ inputRange: [0, 1], outputRange: ['#FFFFFF', '#1E8E3E'] });
    const dotBd = a.interpolate({ inputRange: [0, 1], outputRange: ['#BBBBBB', '#1E8E3E'] });
    const barC = l.interpolate({ inputRange: [0, 1], outputRange: ['#DDDDDD', '#1E8E3E'] });
    return (
        <View style={s.step}>
            <View style={s.rail}>
                <View style={s.dotWrap}>
                    {cur ? <Animated.View style={[s.ring, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }] }]} /> : null}
                    <Animated.View style={[s.dot, { backgroundColor: dotBg, borderColor: dotBd }]} />
                </View>
                {!last ? <Animated.View style={[s.bar, { backgroundColor: barC }]} /> : null}
            </View>
            <Animated.View style={{ flex: 1, paddingBottom: 16, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }}>
                <Text style={[s.stepTxt, { color: text, fontWeight: cur ? '900' : '700' }]}>{STEP[st]}</Text>
                {done && hist?.at ? <Text style={[s.stepTime, { color: muted }]}>{fmt(hist.at)}</Text> : null}
            </Animated.View>
        </View>
    );
}

function StarBtn({ on, onPress }) {
    const v = useRef(new Animated.Value(1)).current;
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        if (!on) return;
        v.setValue(0.6);
        Animated.spring(v, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
    }, [on]);
    return (
        <Pressable onPress={onPress} hitSlop={6}>
            <Animated.View style={{ transform: [{ scale: v }], marginRight: 10 }}>
                <Ionicons name={on ? 'star' : 'star-outline'} size={36} color={on ? '#F5A623' : '#BBBBBB'} />
            </Animated.View>
        </Pressable>
    );
}

export default function OrderDetailScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { id } = useRoute().params || {};
    const { primary, radius, text, muted, error, background, surface, border } = useBrand();
    const reorderOn = useHomeStore((st) => st.full.features.reorder);
    const [o, setO] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | gone | error
    const [stars, setStars] = useState(0);
    const [comment, setComment] = useState('');
    const [saved, setSaved] = useState(null);      // { stars, comment } once the order has a review
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [inv, setInv] = useState('');            // '' | 'view' | 'save'
    const activeRef = useRef(false);
    const ratedLoaded = useRef(false);
    activeRef.current = !!o && isActive(o.status);

    const get = useCallback(async () => {
        try { setO(await fetchOrder(id)); setState('ok'); } catch (e) {
            setState((st) => (st === 'ok' ? 'ok' : e?.response?.status === 404 ? 'gone' : 'error'));
        }
    }, [id]);

    // load now, then every 20 s while the order is still active
    useFocusEffect(useCallback(() => {
        get();
        const t = setInterval(() => { if (activeRef.current) get(); }, 20000);
        return () => clearInterval(t);
    }, [get]));

    // load the review that is already saved for this order
    useEffect(() => {
        if (o?.status !== 'delivered' || ratedLoaded.current) return;
        ratedLoaded.current = true;
        fetchRatings(id).then((r) => {
            const L = r.items || [];
            if (!L.length) return;
            setSaved({
                stars: Math.round(L.reduce((a, x) => a + x.rating, 0) / L.length),
                comment: L.find((x) => x.comment)?.comment || '',
            });
        }).catch(() => { });
    }, [o?.status]);

    const submit = async () => {
        if (!stars || saving) return;
        setSaving(true);
        const c = comment.trim();
        const ids = [...new Set(o.items.map((l) => String(l.productId)))];   // the same dish twice would be rejected
        try {
            await rateOrder(o.id, ids.map((productId) => ({ productId, rating: stars, ...(c ? { comment: c } : {}) })));
            showToast(saved ? 'Review updated' : 'Thanks for your review');
            setSaved({ stars, comment: c });
            setEditing(false);
        } catch (e) { showToast(errMsg(e)); } finally { setSaving(false); }
    };
    const startEdit = () => { setStars(saved.stars); setComment(saved.comment); setEditing(true); };

    if (state === 'loading') {
        return <View style={[s.flex, { backgroundColor: background }]}><BackHeader title="Order" /><ActivityIndicator style={{ marginTop: 60 }} color={primary} /></View>;
    }
    if (state !== 'ok') {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <BackHeader title="Order" />
                <Appear style={s.center}>
                    <Ionicons name="alert-circle-outline" size={44} color={muted} />
                    <Text style={[s.big, { color: text }]}>{state === 'gone' ? 'Order not found' : 'Could not load this order'}</Text>
                    <Press onPress={state === 'gone' ? () => nav.goBack() : get} style={[s.main, { backgroundColor: primary, borderRadius: radius, paddingHorizontal: 28 }]}>
                        <Text style={s.mainTxt}>{state === 'gone' ? 'Go back' : 'Try again'}</Text>
                    </Press>
                </Appear>
            </View>
        );
    }

    const p = o.pricing || {};
    const cancelled = o.status === 'cancelled';
    const delivered = o.status === 'delivered';
    const delivery = o.orderType === 'delivery';
    const live = isActive(o.status);
    const flow = delivery ? FLOW_DELIVERY : FLOW_OTHER;
    const idx = flow.indexOf(o.status);
    const accent = cancelled ? error : delivered ? '#1E8E3E' : primary;
    const sub = cancelled ? `Cancelled by ${WHO[o.cancelledBy] || 'the shop'}${o.cancelReason ? `: ${o.cancelReason}` : ''}`
        : live ? (o.etaMin ? `Usually ready in about ${o.etaMin} min` : 'We will keep this updated')
            : delivered && o.deliveredAt ? `Delivered on ${fmt(o.deliveredAt)}` : '';
    const dock = o.canCancel || reorderOn;
    const timeLine = o.scheduledFor ? (o.pickupUntil ? `${fmt(o.scheduledFor)} – ${tm(o.pickupUntil)}` : fmt(o.scheduledFor)) : '';
    const showForm = !saved || editing;

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <BackHeader title={`Order #${o.orderNo}`} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.pad, { paddingBottom: dock ? 110 : 40 }]}>
                <Appear style={[s.hero, { backgroundColor: tint(accent), borderColor: accent }]}>
                    <View style={[s.heroIc, { backgroundColor: accent }]}>
                        <Ionicons name={ICON[o.status] || 'receipt-outline'} size={26} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                        <View style={{ alignSelf: 'flex-start' }}><StatusPill status={o.status} /></View>
                        {sub ? <Text style={[s.heroSub, { color: text }]}>{sub}</Text> : null}
                        <Text style={[s.muted, { color: muted }]}>{delivery ? 'Delivery' : 'Pickup'} · {PAY[o.payment?.method] || 'Cash on delivery'}{o.payment?.status === 'paid' ? ' · Paid' : ''}</Text>
                    </View>
                </Appear>

                {!cancelled ? (
                    <Card title="Order status" icon="time-outline" delay={60}>
                        {flow.map((st, k) => (
                            <Step key={st} st={st} k={k} idx={idx} live={live} last={k === flow.length - 1}
                                hist={(o.statusHistory || []).find((x) => x.status === st)} />
                        ))}
                    </Card>
                ) : null}

                <Card title="Items" icon="fast-food-outline" delay={100}>
                    {o.items.map((l, i) => (
                        <View key={`${l.productId}${i}`} style={s.item}>
                            <View style={[s.qty, { backgroundColor: tint(primary) }]}><Text style={[s.qtyTxt, { color: primary }]}>{l.quantity}×</Text></View>
                            <View style={{ flex: 1, marginHorizontal: 10 }}>
                                <Text style={[s.itemName, { color: text }]}>{l.name}</Text>
                                {l.selections?.length ? <Text style={[s.muted, { color: muted }]}>{l.selections.map((x) => x.name).join(', ')}</Text> : null}
                                {l.note ? <Text style={[s.muted, { color: muted }]}>Note: {l.note}</Text> : null}
                            </View>
                            <Text style={[s.itemName, { color: text }]}>{rs(l.lineTotal)}</Text>
                        </View>
                    ))}
                </Card>

                <Card title="Bill details" icon="receipt-outline" delay={140}>
                    <Row k="Subtotal" v={rs(p.subtotal)} />
                    {p.discount > 0 ? <Row k={`Coupon${p.couponCode ? ` (${p.couponCode})` : ''}`} v={`− ${rs(p.discount)}`} green /> : null}
                    {delivery ? <Row k="Delivery fee" v={p.deliveryFee > 0 ? rs(p.deliveryFee) : 'Free'} green={!p.deliveryFee} /> : null}
                    {p.packagingCharge > 0 ? <Row k="Packaging" v={rs(p.packagingCharge)} /> : null}
                    {p.taxMode === 'exclusive' && p.tax > 0 ? <Row k="GST" v={rs(p.tax)} /> : null}
                    {p.tip > 0 ? <Row k="Tip" v={rs(p.tip)} /> : null}
                    <View style={[s.line, { backgroundColor: border }]} />
                    <Row k="Total" v={rs(p.total)} bold />
                    {p.taxMode === 'inclusive' && p.tax > 0 ? <Text style={[s.muted, { color: muted }]}>Includes {rs(p.tax)} GST</Text> : null}
                </Card>

                {delivered ? (
                    <Card title="Invoice" icon="document-text-outline" delay={170}>
                        <View style={s.iconRow}>
                            <Press wrap={{ flex: 1, marginRight: 10 }} disabled={!!inv} onPress={() => viewInvoice(o, (v) => setInv(v ? 'view' : ''))}
                                style={[s.dBtn, { borderColor: primary, borderWidth: 1.5, borderRadius: radius }]}>
                                {inv === 'view' ? <ActivityIndicator color={primary} /> : (
                                    <View style={s.iconRow}>
                                        <Ionicons name="eye-outline" size={18} color={primary} />
                                        <Text style={[s.ghostTxt, { color: primary, marginLeft: 6 }]}>View</Text>
                                    </View>
                                )}
                            </Press>
                            <Press wrap={{ flex: 1 }} disabled={!!inv} onPress={() => saveInvoice(o, (v) => setInv(v ? 'save' : ''))}
                                style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                                {inv === 'save' ? <ActivityIndicator color="#FFFFFF" /> : (
                                    <View style={s.iconRow}>
                                        <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                                        <Text style={[s.mainTxt, { marginLeft: 6 }]}>Download</Text>
                                    </View>
                                )}
                            </Press>
                        </View>
                        <Text style={[s.muted, { color: muted }]}>Saved as invoice-{o.orderNo}.pdf</Text>
                    </Card>
                ) : null}

                {timeLine ? (
                    <Card title={delivery ? 'Scheduled for' : 'Pickup time'} icon="calendar-outline" delay={180}>
                        <Text style={[s.itemName, { color: text }]}>{timeLine}</Text>
                    </Card>
                ) : null}
                {delivery && o.address ? (
                    <Card title="Delivery address" icon="location-outline" delay={200}>
                        <Text style={[s.itemName, { color: text }]}>{[o.address.label, o.address.name].filter(Boolean).join(' · ')}</Text>
                        <Text style={[s.muted, { color: muted }]}>{addr(o.address)}</Text>
                    </Card>
                ) : null}
                {o.note ? <Card title="Order note" icon="create-outline" delay={220}><Text style={[s.muted, { color: muted, marginTop: 0 }]}>{o.note}</Text></Card> : null}

                {delivered ? (
                    <Card title={showForm ? (editing ? 'Edit your review' : 'Rate this order') : 'Your review'} icon="star-outline" delay={240}>
                        {showForm ? (
                            <>
                                <View style={s.stars}>
                                    {[1, 2, 3, 4, 5].map((k) => <StarBtn key={k} on={stars >= k} onPress={() => setStars(k)} />)}
                                </View>
                                <Text style={[s.word, { color: stars ? '#F5A623' : muted }]}>{stars ? WORDS[stars - 1] : 'Tap a star to rate'}</Text>
                                <TextInput
                                    value={comment} onChangeText={setComment} multiline maxLength={300}
                                    placeholder="Tell us how it was (optional)" placeholderTextColor={muted}
                                    style={[s.review, { color: text, borderColor: border, backgroundColor: background }]}
                                />
                                <Text style={[s.count, { color: muted }]}>{comment.length}/300</Text>
                                <View style={s.iconRow}>
                                    {editing ? (
                                        <Press wrap={{ flex: 1, marginRight: 10 }} disabled={saving} onPress={() => setEditing(false)}
                                            style={[s.dBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                                            <Text style={[s.ghostTxt, { color: text }]}>Cancel</Text>
                                        </Press>
                                    ) : null}
                                    <Press wrap={{ flex: 1.4, opacity: stars ? 1 : 0.5 }} disabled={!stars || saving} onPress={submit}
                                        style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                                        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>{editing ? 'Update review' : 'Submit review'}</Text>}
                                    </Press>
                                </View>
                            </>
                        ) : (
                            <>
                                <View style={s.stars}>
                                    {[1, 2, 3, 4, 5].map((k) => (
                                        <Ionicons key={k} name={saved.stars >= k ? 'star' : 'star-outline'} size={26} color={saved.stars >= k ? '#F5A623' : '#BBBBBB'} style={{ marginRight: 6 }} />
                                    ))}
                                </View>
                                <Text style={[s.saved, { color: saved.comment ? text : muted }]}>{saved.comment || 'No comment added'}</Text>
                                <Press onPress={startEdit} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                                    <View style={s.iconRow}>
                                        <Ionicons name="create-outline" size={17} color={primary} />
                                        <Text style={[s.ghostTxt, { color: primary, marginLeft: 6 }]}>Edit review</Text>
                                    </View>
                                </Press>
                            </>
                        )}
                    </Card>
                ) : null}
            </ScrollView>

            {dock ? (
                <Appear style={[s.dock, { backgroundColor: surface, borderTopColor: border, paddingBottom: (insets.bottom || 12) + 4 }]}>
                    {o.canCancel ? (
                        <Press wrap={{ flex: 1, marginRight: reorderOn ? 10 : 0 }} disabled={busy} onPress={() => cancelFlow(o, { setBusy, onDone: setO })}
                            style={[s.dBtn, { borderColor: error, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: error }]}>Cancel order</Text>
                        </Press>
                    ) : null}
                    {reorderOn ? (
                        <Press wrap={{ flex: 1.4 }} disabled={busy} onPress={() => reorder(o, nav, setBusy)}
                            style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>Reorder</Text>}
                        </Press>
                    ) : null}
                </Appear>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    pad: { padding: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800', marginTop: 12 },
    hero: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 16 },
    heroIc: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    heroSub: { fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 18 },
    card: { marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 16 },
    cHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    h: { fontSize: 15, fontWeight: '900', marginLeft: 8 },
    muted: { fontSize: 12, marginTop: 3, lineHeight: 17 },
    step: { flexDirection: 'row' },
    rail: { width: 26, alignItems: 'center' },
    dotWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
    ring: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#1E8E3E' },
    bar: { flex: 1, width: 2, marginTop: 2 },
    stepTxt: { fontSize: 14, marginLeft: 6 },
    stepTime: { fontSize: 11, marginTop: 2, marginLeft: 6 },
    item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
    qty: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    qtyTxt: { fontSize: 12, fontWeight: '900' },
    itemName: { fontSize: 14, fontWeight: '700' },
    line: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
    bRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    bK: { fontSize: 13, fontWeight: '500' },
    bold: { fontSize: 16, fontWeight: '900' },
    stars: { flexDirection: 'row', marginBottom: 6 },
    word: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
    review: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90, textAlignVertical: 'top', fontSize: 14, marginTop: 8 },
    count: { fontSize: 11, textAlign: 'right', marginTop: 4, marginBottom: 12 },
    saved: { fontSize: 14, lineHeight: 20, marginTop: 6 },
    ghost: { marginTop: 16, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    ghostTxt: { fontSize: 14, fontWeight: '800' },
    iconRow: { flexDirection: 'row', alignItems: 'center' },
    main: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    mainTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, elevation: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: -4 } },
    dBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
});