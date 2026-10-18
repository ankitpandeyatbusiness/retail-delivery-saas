// src/screens/OrderDetailScreen.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, TextInput, StyleSheet, Animated, Easing, Image } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useBrand, BackHeader, CardGlow, mix } from '../../components/common/kit';
import { Skel } from '../../components/common/motion';
import { showToast, tint } from '../../components/customers/shop';
import { Press, Appear } from '../../components/customers/cartParts';
import { StatusPill, isActive, rs, errMsg, cancelFlow, reorder } from '../../components/customers/orders';
import { viewInvoice, saveInvoice } from '../../components/customers/invoice';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { fetchOrder, rateOrder, fetchRatings, fetchTracking } from '../../api/customers/shopApi';
import TrackingCard from '../../components/customers/tracking';
import { StoreLocation, useStoreSpot } from '../../components/customers/storeLocation';
import { DeliveryRatingCard, ComplaintCard } from '../../components/common/feedback';
import { useOrderLive } from '../../hooks/customers/useOrderLive';
import { onRiderLocation } from '../../api/common/socket';
import { useAuthStore } from '../../store/common/useAuthStore';
import { payForOrder } from '../../utils/customers/payOnline';
import { tr } from '../../i18n';

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
            <CardGlow radius={18} from="tl" strength={0.14} />
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
    const { text, ok } = useBrand();
    const c = green ? ok : text;
    return (
        <View style={s.bRow}>
            <Text style={[s.bK, bold && s.bold, { color: c }]}>{k}</Text>
            <Text style={[s.bK, bold && s.bold, { color: c }]}>{v}</Text>
        </View>
    );
}

function Step({ st, k, idx, last, hist, live }) {
    const { text, muted, surface, border, ok } = useBrand();
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
    const dotBg = a.interpolate({ inputRange: [0, 1], outputRange: [surface, ok] });
    const dotBd = a.interpolate({ inputRange: [0, 1], outputRange: [muted, ok] });
    const barC = l.interpolate({ inputRange: [0, 1], outputRange: [border, ok] });
    return (
        <View style={s.step}>
            <View style={s.rail}>
                <View style={s.dotWrap}>
                    {cur ? <Animated.View style={[s.ring, { backgroundColor: ok, opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }] }]} /> : null}
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
    const { primary, radius, text, muted, error, background, surface, border, ok } = useBrand();
    const reorderOn = useHomeStore((st) => st.full.features.reorder);
    const spot = useStoreSpot();
    const [o, setO] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | gone | error
    const [stars, setStars] = useState(0);
    const [comment, setComment] = useState('');
    const [saved, setSaved] = useState(null);      // { stars, comment } once the order has a review
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [inv, setInv] = useState('');            // '' | 'view' | 'save'
    const user = useAuthStore((st) => st.user);
    const [track, setTrack] = useState(null);     // GET /orders/:id/tracking, delivery orders only
    const trackRef = useRef(null);
    trackRef.current = track;
    const activeRef = useRef(false);
    const ratedLoaded = useRef(false);
    activeRef.current = !!o && isActive(o.status);

    const get = useCallback(async () => {
        try {
            const ord = await fetchOrder(id);
            setO(ord); setState('ok');
            if (ord.orderType === 'delivery' && (isActive(ord.status) || ord.status === 'delivered')) {
                fetchTracking(id).then(setTrack).catch(() => { /* the card simply stays as it was */ });
            } else setTrack(null);
        } catch (e) {
            setState((st) => (st === 'ok' ? 'ok' : e?.response?.status === 404 ? 'gone' : 'error'));
        }
    }, [id]);

    // The server tells us at once when the order changes (status, rider accepted...). The timer is only a safety net,
    // and runs faster while the rider is on the way because his position is not pushed.
    useOrderLive(id, get);
    // the rider's pin moves the moment the server hears from his phone (no waiting for the next refresh)
    useEffect(() => onRiderLocation((p) => {
        if (String(p?.orderId) !== String(id) || typeof p.lat !== 'number') return;
        setTrack((t) => (t && t.state !== 'delivered' && t.state !== 'cancelled' ? { ...t, riderLocation: { lat: p.lat, lng: p.lng, at: p.at } } : t));
    }), [id]);
    useFocusEffect(useCallback(() => {
        get();
        const t = setInterval(() => { if (activeRef.current) get(); }, trackRef.current?.state === 'on_the_way' ? 15000 : 45000);
        return () => clearInterval(t);
    }, [get, track?.state === 'on_the_way']));

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
            showToast(saved ? tr('Review updated') : tr('Thanks for your review'));
            setSaved({ stars, comment: c });
            setEditing(false);
        } catch (e) { showToast(errMsg(e)); } finally { setSaving(false); }
    };
    const startEdit = () => { setStars(saved.stars); setComment(saved.comment); setEditing(true); };

    if (state === 'loading') {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <BackHeader title={tr('Order')} />
                <View style={s.pad}>
                    <Skel height={150} radius={22} />
                    <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                        <Skel width="35%" height={16} />
                        {[0, 1, 2].map((i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
                                <Skel width={16} height={16} radius={8} />
                                <Skel width="50%" height={14} style={{ marginLeft: 14 }} />
                            </View>
                        ))}
                    </View>
                    <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                        <Skel width="28%" height={16} />
                        <Skel height={44} style={{ marginTop: 16 }} />
                        <Skel height={44} style={{ marginTop: 10 }} />
                    </View>
                </View>
            </View>
        );
    }
    if (state !== 'ok') {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <BackHeader title={tr('Order')} />
                <Appear style={s.center}>
                    <Ionicons name="alert-circle-outline" size={44} color={muted} />
                    <Text style={[s.big, { color: text }]}>{state === 'gone' ? tr('Order not found') : tr('Could not load this order')}</Text>
                    <Press onPress={state === 'gone' ? () => nav.goBack() : get} style={[s.main, { backgroundColor: primary, borderRadius: radius, paddingHorizontal: 28 }]}>
                        <Text style={s.mainTxt}>{state === 'gone' ? tr('Go back') : tr('Try again')}</Text>
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
    const accent = cancelled ? error : delivered ? ok : primary;
    const headline = cancelled ? 'Order cancelled' : (STEP[o.status] || 'Order');
    const sub = cancelled ? `Cancelled by ${WHO[o.cancelledBy] || 'the shop'}${o.cancelReason ? `: ${o.cancelReason}` : ''}`
        : live ? (o.etaMin ? `Usually ready in about ${o.etaMin} min` : 'We will keep this updated')
            : delivered && o.deliveredAt ? `Delivered on ${fmt(o.deliveredAt)}` : '';
    // an online order that was placed but not paid yet (payment cancelled or failed): let the customer pay again
    const payable = !!o.payment && o.payment.method !== 'cod' && o.payment.status !== 'paid' && o.status === 'placed';
    const payNow = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const r = await payForOrder({ order: o, user });
            if (r.order) setO(r.order);
            showToast(r.status === 'paid' ? tr('Payment successful') : r.message || tr('Payment not completed'));
            if (r.status !== 'paid') get();
        } finally { setBusy(false); }
    };
    const dock = o.canCancel || reorderOn || payable;
    const timeLine = o.scheduledFor ? (o.pickupUntil ? `${fmt(o.scheduledFor)} – ${tm(o.pickupUntil)}` : fmt(o.scheduledFor)) : '';
    const showForm = !saved || editing;

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <BackHeader title={tr('Order #{orderNo}', { orderNo: o.orderNo })} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.pad, { paddingBottom: dock ? 110 : 40 }]}>
                <Appear>
                    <LinearGradient colors={[accent, mix(accent, '#000000', 0.28)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
                        <View style={[s.blob, { top: -50, right: -30, width: 150, height: 150 }]} />
                        <View style={[s.blob, { bottom: -60, left: 40, width: 110, height: 110, opacity: 0.6 }]} />
                        <View style={s.heroTop}>
                            <View style={{ flex: 1, paddingRight: 12 }}>
                                <Text style={s.heroCap}>{delivery ? tr('DELIVERY') : tr('PICKUP')}  ·  {fmt(o.createdAt)}</Text>
                                <Text style={s.heroHead} numberOfLines={2}>{headline}</Text>
                                {sub ? <Text style={s.heroSub}>{sub}</Text> : null}
                            </View>
                            <View style={s.heroIc}>
                                <Ionicons name={ICON[o.status] || 'receipt-outline'} size={30} color="#FFFFFF" />
                            </View>
                        </View>

                        {live && idx >= 0 ? (
                            <View style={s.segs}>
                                {flow.map((st, k) => <View key={st} style={[s.seg, { backgroundColor: k <= idx ? '#FFFFFF' : 'rgba(255,255,255,0.28)' }]} />)}
                            </View>
                        ) : null}

                        <View style={s.facts}>
                            <View style={s.fact}><Text style={s.factK}>{tr('TOTAL')}</Text><Text style={s.factV}>{rs(p.total)}</Text></View>
                            <View style={s.fact}><Text style={s.factK}>{tr('ITEMS')}</Text><Text style={s.factV}>{o.items.reduce((n, l) => n + (l.measure ? 1 : l.quantity), 0)}</Text></View>
                            <View style={s.fact}>
                                <Text style={s.factK}>{tr('PAYMENT')}</Text>
                                <Text style={s.factV} numberOfLines={1}>{PAY[o.payment?.method] || tr('Cash')}{o.payment?.status === 'paid' ? tr(' · Paid') : ''}</Text>
                            </View>
                        </View>
                    </LinearGradient>
                </Appear>

                {delivery && live && track && track.state !== 'cancelled' ? (
                    <TrackingCard tracking={track} destination={o.address} />
                ) : null}

                {!cancelled ? (
                    <Card title={tr('Order status')} icon="time-outline" delay={60}>
                        {flow.map((st, k) => (
                            <Step key={st} st={st} k={k} idx={idx} live={live} last={k === flow.length - 1}
                                hist={(o.statusHistory || []).find((x) => x.status === st)} />
                        ))}
                    </Card>
                ) : null}

                <Card title={tr('Items')} icon="fast-food-outline" delay={100}>
                    {o.items.map((l, i) => (
                        <View key={`${l.productId}${i}`} style={s.item}>
                            {l.image ? <Image source={{ uri: l.image }} style={[s.itemPic, { backgroundColor: border }]} /> : <View style={[s.itemPic, { backgroundColor: tint(primary), alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="fast-food-outline" size={18} color={primary} /></View>}
                            <View style={[s.qty, { backgroundColor: tint(primary), marginLeft: 10 }]}><Text style={[s.qtyTxt, { color: primary }]}>{l.measure?.label || `${l.quantity}×`}</Text></View>
                            <View style={{ flex: 1, marginHorizontal: 10 }}>
                                <Text style={[s.itemName, { color: text }]}>{l.name}</Text>
                                {l.selections?.length ? <Text style={[s.muted, { color: muted }]}>{l.selections.map((x) => x.name).join(', ')}</Text> : null}
                                {l.note ? <Text style={[s.muted, { color: muted }]}>{tr('Note: {note}', { note: l.note })}</Text> : null}
                            </View>
                            <Text style={[s.itemName, { color: text }]}>{rs(l.lineTotal)}</Text>
                        </View>
                    ))}
                </Card>

                <Card title={tr('Bill details')} icon="receipt-outline" delay={140}>
                    <Row k={tr('Subtotal')} v={rs(p.subtotal)} />
                    {p.discount > 0 ? <Row k={tr('Coupon{v1}', { v1: p.couponCode ? ` (${p.couponCode})` : '' })} v={`− ${rs(p.discount)}`} green /> : null}
                    {delivery ? <Row k={tr('Delivery fee')} v={p.deliveryFee > 0 ? rs(p.deliveryFee) : 'Free'} green={!p.deliveryFee} /> : null}
                    {p.packagingCharge > 0 ? <Row k={tr('Packaging')} v={rs(p.packagingCharge)} /> : null}
                    {p.taxMode === 'exclusive' && p.tax > 0 ? <Row k={tr('GST')} v={rs(p.tax)} /> : null}
                    {p.tip > 0 ? <Row k={tr('Tip')} v={rs(p.tip)} /> : null}
                    <View style={[s.line, { backgroundColor: border }]} />
                    <Row k={tr('Total')} v={rs(p.total)} bold />
                    {p.taxMode === 'inclusive' && p.tax > 0 ? <Text style={[s.muted, { color: muted }]}>{tr('Includes {rs} GST', { rs: rs(p.tax) })}</Text> : null}
                </Card>

                {delivered ? (
                    <Card title={tr('Invoice')} icon="document-text-outline" delay={170}>
                        <View style={s.iconRow}>
                            <Press wrap={{ flex: 1, marginRight: 10 }} disabled={!!inv} onPress={() => viewInvoice(o, (v) => setInv(v ? 'view' : ''))}
                                style={[s.dBtn, { borderColor: primary, borderWidth: 1.5, borderRadius: radius }]}>
                                {inv === 'view' ? <ActivityIndicator color={primary} /> : (
                                    <View style={s.iconRow}>
                                        <Ionicons name="eye-outline" size={18} color={primary} />
                                        <Text style={[s.ghostTxt, { color: primary, marginLeft: 6 }]}>{tr('View')}</Text>
                                    </View>
                                )}
                            </Press>
                            <Press wrap={{ flex: 1 }} disabled={!!inv} onPress={() => saveInvoice(o, (v) => setInv(v ? 'save' : ''))}
                                style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                                {inv === 'save' ? <ActivityIndicator color="#FFFFFF" /> : (
                                    <View style={s.iconRow}>
                                        <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                                        <Text style={[s.mainTxt, { marginLeft: 6 }]}>{tr('Download')}</Text>
                                    </View>
                                )}
                            </Press>
                        </View>
                        <Text style={[s.muted, { color: muted }]}>{tr('Saved as invoice-{orderNo}.pdf', { orderNo: o.orderNo })}</Text>
                    </Card>
                ) : null}

                {timeLine ? (
                    <Card title={delivery ? tr('Scheduled for') : tr('Pickup time')} icon="calendar-outline" delay={180}>
                        <Text style={[s.itemName, { color: text }]}>{timeLine}</Text>
                    </Card>
                ) : null}
                {/* a pickup order: where to collect it, with Directions */}
                {!delivery && spot.on && (spot.address || spot.pinned) ? (
                    <Card title={tr('Pickup from')} icon="storefront-outline" delay={190}>
                        <StoreLocation inline />
                    </Card>
                ) : null}
                {delivery && o.address ? (
                    <Card title={tr('Delivery address')} icon="location-outline" delay={200}>
                        <Text style={[s.itemName, { color: text }]}>{[o.address.label, o.address.name].filter(Boolean).join(' · ')}</Text>
                        <Text style={[s.muted, { color: muted }]}>{addr(o.address)}</Text>
                    </Card>
                ) : null}
                {o.note ? <Card title={tr('Order note')} icon="create-outline" delay={220}><Text style={[s.muted, { color: muted, marginTop: 0 }]}>{o.note}</Text></Card> : null}

                {delivered ? (
                    <Card title={showForm ? (editing ? tr('Edit your review') : tr('Rate this order')) : tr('Your review')} icon="star-outline" delay={240}>
                        {showForm ? (
                            <>
                                <View style={s.stars}>
                                    {[1, 2, 3, 4, 5].map((k) => <StarBtn key={k} on={stars >= k} onPress={() => setStars(k)} />)}
                                </View>
                                <Text style={[s.word, { color: stars ? '#F5A623' : muted }]}>{stars ? WORDS[stars - 1] : tr('Tap a star to rate')}</Text>
                                <TextInput
                                    value={comment} onChangeText={setComment} multiline maxLength={300}
                                    placeholder={tr('Tell us how it was (optional)')} placeholderTextColor={muted}
                                    style={[s.review, { color: text, borderColor: border, backgroundColor: background }]}
                                />
                                <Text style={[s.count, { color: muted }]}>{comment.length}/300</Text>
                                <View style={s.iconRow}>
                                    {editing ? (
                                        <Press wrap={{ flex: 1, marginRight: 10 }} disabled={saving} onPress={() => setEditing(false)}
                                            style={[s.dBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                                            <Text style={[s.ghostTxt, { color: text }]}>{tr('Cancel')}</Text>
                                        </Press>
                                    ) : null}
                                    <Press wrap={{ flex: 1.4, opacity: stars ? 1 : 0.5 }} disabled={!stars || saving} onPress={submit}
                                        style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                                        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>{editing ? tr('Update review') : tr('Submit review')}</Text>}
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
                                <Text style={[s.saved, { color: saved.comment ? text : muted }]}>{saved.comment || tr('No comment added')}</Text>
                                <Press onPress={startEdit} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                                    <View style={s.iconRow}>
                                        <Ionicons name="create-outline" size={17} color={primary} />
                                        <Text style={[s.ghostTxt, { color: primary, marginLeft: 6 }]}>{tr('Edit review')}</Text>
                                    </View>
                                </Press>
                            </>
                        )}
                    </Card>
                ) : null}

                {delivered && delivery && o.delivery?.proof?.url ? (
                    <Card title={tr('Delivery photo')} icon="camera-outline" delay={90}>
                        <Image source={{ uri: o.delivery.proof.url }} style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: border }} resizeMode="cover" />
                        <Text style={[s.muted, { color: muted, marginTop: 8 }]}>{tr('Taken by your delivery partner when the food was handed over.')}</Text>
                    </Card>
                ) : null}

                {delivered && delivery && track ? (
                    <DeliveryRatingCard orderId={id} tracking={track} onDone={get} />
                ) : null}
                {delivered ? <ComplaintCard orderId={id} /> : null}
            </ScrollView>

            {dock ? (
                <Appear style={[s.dock, { backgroundColor: surface, borderTopColor: border, paddingBottom: (insets.bottom || 12) + 4 }]}>
                    {o.canCancel ? (
                        <Press wrap={{ flex: 1, marginRight: reorderOn ? 10 : 0 }} disabled={busy} onPress={() => cancelFlow(o, { setBusy, onDone: setO })}
                            style={[s.dBtn, { borderColor: error, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: error }]}>{tr('Cancel order')}</Text>
                        </Press>
                    ) : null}
                    {payable ? (
                        <Press wrap={{ flex: 1.4 }} disabled={busy} onPress={payNow}
                            style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>{tr('Pay {rs}', { rs: rs(o.pricing?.total) })}</Text>}
                        </Press>
                    ) : reorderOn ? (
                        <Press wrap={{ flex: 1.4 }} disabled={busy} onPress={() => reorder(o, nav, setBusy)}
                            style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>{tr('Reorder')}</Text>}
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
    hero: { borderRadius: 24, padding: 18, overflow: 'hidden' },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
    heroTop: { flexDirection: 'row', alignItems: 'center' },
    heroCap: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '900', letterSpacing: 1, opacity: 0.85 },
    heroHead: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.6, marginTop: 6 },
    heroSub: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginTop: 6, lineHeight: 18, opacity: 0.92 },
    heroIc: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    segs: { flexDirection: 'row', marginTop: 18 },
    seg: { flex: 1, height: 5, borderRadius: 3, marginRight: 5 },
    facts: { flexDirection: 'row', marginTop: 18, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.35)' },
    fact: { flex: 1 },
    factK: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, opacity: 0.75 },
    factV: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginTop: 3 },
    itemPic: { width: 44, height: 44, borderRadius: 12, overflow: 'hidden' },
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