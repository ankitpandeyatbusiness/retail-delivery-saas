// src/screens/CartScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, StyleSheet, LayoutAnimation, UIManager, Platform } from 'react-native';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import { useBrand, BackHeader } from '../components/ui/kit';
import { VegDot, showToast, tint } from '../components/ui/shop';
import { AddressSheet, addrLine } from '../components/ui/addresses';
import { Press, Appear, Chip, Bill, ClosedBanner, PickupSlots, FreeDeliveryBar, rs, ease } from '../components/ui/cartParts';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/shopStores';
import { quoteOrder, placeOrder, fetchAddresses, fetchPickupSlots } from '../api/shopApi';
import { useCouponStore } from '../store/useCouponStore';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const errMsg = (e) => e?.response?.data?.error
    || (e?.response ? 'Something went wrong. Try again.' : 'Network problem. Check your connection.');
const hr = (d) => `${d.getHours() % 12 || 12} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
const QUICK_NOTES = ['Leave at door', 'Avoid calling', "Don't ring bell"];

function makeSlots(prepMin) {
    const now = new Date();
    const out = {};
    const t = new Date(now.getTime() + (prepMin + 30) * 60000);
    t.setMinutes(0, 0, 0);
    t.setHours(t.getHours() + 1);
    if (t.toDateString() === now.toDateString()) out.today = { label: `Today ${hr(t)}`, iso: t.toISOString() };
    const tm = new Date(now);
    tm.setDate(tm.getDate() + 1);
    tm.setHours(13, 0, 0, 0);
    out.tomorrow = { label: 'Tomorrow 1 PM', iso: tm.toISOString() };
    return out;
}

export default function CartScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const insets = useSafeAreaInsets();
    const { primary, radius, text, error, background, surface, border, muted } = useBrand();

    const user = useAuthStore((st) => st.user);
    const full = useHomeStore((st) => st.full);
    const offers = useHomeStore((st) => st.offers) || [];
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const lines = useCartStore((st) => st.lines);
    const f = full.features;
    const feeConfig = full.orders.deliveryFee || {};

    const types = useMemo(() => {
        const t = (full.orders.types || []).filter((x) => x === 'delivery' || x === 'pickup');
        return t.length ? t : ['delivery'];
    }, [full.orders.types]);

    const [pickedType, setPickedType] = useState(types[0]);
    const type = types.includes(pickedType) ? pickedType : types[0];

    const [couponIn, setCouponIn] = useState('');
    const [tryCode, setTryCode] = useState('');      // coupon being checked right now
    const [applied, setApplied] = useState('');      // coupon the server accepted
    const [couponErr, setCouponErr] = useState('');
    const [when, setWhen] = useState('now');
    const [tip, setTip] = useState(0);
    const [delNotes, setDelNotes] = useState([]);
    const [customNote, setCustomNote] = useState('');
    const [addr, setAddr] = useState(null);
    const [sheet, setSheet] = useState(false);
    const [slotRes, setSlotRes] = useState(null);
    const [pickedSlot, setPickedSlot] = useState(null);

    const selectedPaymentMethod = route.params?.selectedPaymentMethod || 'Cash on Delivery';
    const paymentMethodValue = route.params?.paymentMethodValue || 'cod';

    const [quote, setQuote] = useState(null);
    const [quoteKey, setQuoteKey] = useState('');    // which request the quote belongs to
    const [qErr, setQErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [tick, setTick] = useState(0);
    const [idemKey] = useState(() => Crypto.randomUUID());
    const reqId = useRef(0);

    const slots = useMemo(() => makeSlots(full.orders.prepTimeMin || 20), []);
    const couponOn = f.couponField && full.offers.couponsEnabled;
    const preview = lines.reduce((a, l) => a + l.price * l.quantity, 0);
    const priceKey = lines.map((l) => l.price).join(',');
    const pending = useCouponStore((st) => st.code);

    // Only what changes the price goes here, so typing a note never re-quotes.
    const body = useMemo(() => {
        if (!lines.length) return null;
        const b = {
            orderType: type,
            paymentMethod: paymentMethodValue,
            items: lines.map((l) => ({
                productId: l.productId, quantity: l.quantity, selections: l.selections || [], note: l.note || undefined,
            })),
        };
        const code = applied || tryCode;
        if (code && couponOn) b.couponCode = code;
        if (type === 'delivery') {
            if (addr) b.addressId = addr._id;
            if (f.tips && tip > 0) b.tip = tip;
            if (f.scheduleOrder && when !== 'now' && slots[when]) b.scheduledFor = slots[when].iso;
        }
        if (type === 'pickup' && pickedSlot) b.pickupSlot = pickedSlot;
        return b;
    }, [lines, type, applied, tryCode, addr, tip, when, couponOn, paymentMethodValue, pickedSlot]);
    const bodyKey = JSON.stringify(body);

    // refresh every minute so a shop that just closed is noticed
    useEffect(() => {
        const i = setInterval(() => setTick((x) => x + 1), 60000);
        return () => clearInterval(i);
    }, []);

    useEffect(() => {
        if (!user || type !== 'delivery' || addr) return undefined;
        let on = true;
        fetchAddresses().then((r) => {
            if (!on) return;
            const L = r.items || [];
            setAddr((a) => a || L.find((x) => x.isDefault) || L[0] || null);
        }).catch(() => { });
        return () => { on = false; };
    }, [user, type]);

    // pickup time windows (worked out by the server from the shop hours)
    useEffect(() => {
        if (!user || type !== 'pickup') return undefined;
        let on = true;
        fetchPickupSlots().then((r) => {
            if (!on) return;
            ease();
            setSlotRes(r);
            setPickedSlot((p) => (p && r.slots.some((x) => x.from === p) ? p : null));
        }).catch(() => { if (on) setSlotRes({ open: true, slots: [], message: 'Could not load pickup times. Try again.' }); });
        return () => { on = false; };
    }, [user, type, tick]);

    useEffect(() => {
        if (!user || !body) { setQuote(null); setQErr(''); setBusy(false); return undefined; }
        setBusy(true);
        const id = ++reqId.current;
        const t = setTimeout(async () => {
            const run = async (b) => { try { return { q: await quoteOrder(b) }; } catch (e) { return { e }; } };
            let r = await run(body);
            let cErr = '';
            // the server refused the coupon: price the cart without it and say why
            if (r.e && body.couponCode) {
                const r2 = await run({ ...body, couponCode: undefined });
                if (r2.q) { cErr = errMsg(r.e); r = r2; }
            }
            if (id !== reqId.current) return;
            ease();
            if (cErr) { setCouponErr(cErr); setApplied(''); setTryCode(''); }
            else if (r.q && body.couponCode && !applied && r.q.pricing.couponCode) {
                setApplied(body.couponCode); setTryCode(''); setCouponIn(''); setCouponErr('');
            } else if (r.q && applied && !r.q.pricing.couponCode) {
                setApplied(''); setCouponErr('Coupon removed. Your order no longer qualifies.');
            }
            if (r.q) { setQuote(r.q); setQErr(''); setQuoteKey(bodyKey); } else { setQuote(null); setQErr(errMsg(r.e)); }
            setBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [bodyKey, priceKey, user, tick]);

    useEffect(() => {
        if (pending && user && couponOn && lines.length) {
            setCouponIn(pending);
            setTryCode(String(pending).trim().toUpperCase());
            useCouponStore.getState().clear();
        }
    }, [pending, user, couponOn, lines.length]);

    const apply = () => {
        const c = couponIn.trim().toUpperCase();
        if (!c) return;
        ease(); setCouponErr(''); setTryCode(c);
    };
    const pickOffer = (code) => { setCouponIn(code); ease(); setCouponErr(''); setTryCode(code); };
    const toggleNote = (n) => { ease(); setDelNotes((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n])); };
    const setQty = (key, q) => { ease(); useCartStore.getState().setQty(key, q); };

    const fresh = !!quote && quoteKey === bodyKey;
    const closed = quote ? quote.shopOpen === false : full.restaurant?.isOpen === false;
    const closedMsg = full.hours?.closedMessage || full.labels?.closedMessage || 'We are closed right now';

    const place = async () => {
        if (placing || !fresh || !quote.canPlace || closed) return;
        setPlacing(true);
        try {
            const notes = [...delNotes];
            if (customNote.trim()) notes.push(customNote.trim());
            await placeOrder(notes.length ? { ...body, note: notes.join(' | ') } : body, idemKey);
            useCartStore.getState().clear();
            showToast('Order placed successfully');
            nav.dispatch(CommonActions.reset({
                index: 0,
                routes: [{ name: 'MainTabs', state: { routes: [{ name: 'Orders' }] } }],
            }));
        } catch (e) {
            const m = errMsg(e);
            showToast(m);
            if (/coupon/i.test(m)) { ease(); setApplied(''); setCouponErr(m); }
            if (e?.response) setTick((x) => x + 1);
        } finally { setPlacing(false); }
    };

    const linePrice = (l, i) => {
        const q = quote?.items?.[i];
        const ok = q && String(q.productId) === String(l.productId) && q.quantity === l.quantity;
        return ok ? q.lineTotal : +(l.price * l.quantity).toFixed(2);
    };

    if (!lines.length) {
        return (
            <View style={[s.flex, { backgroundColor: background }]}>
                <BackHeader title="Cart" />
                <Appear style={s.center}>
                    <View style={[s.iconCircle, { backgroundColor: surface, borderColor: border }]}>
                        <Ionicons name="cart-outline" size={48} color={muted} />
                    </View>
                    <Text style={[s.big, { color: text }]}>{full.labels.emptyCart}</Text>
                    <Text style={[s.lSub, { color: muted, marginTop: 6 }]}>Good food is always cooking.</Text>
                    <Press onPress={() => nav.goBack()} style={[s.cta, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text style={s.ctaTxt}>Browse Menu</Text>
                    </Press>
                </Appear>
            </View>
        );
    }

    const freeAbove = feeConfig.freeAbove || 0;
    const unlocked = freeAbove > 0 && preview >= freeAbove;

    let btnText = 'Place Order';
    let btnOn = false;
    let note = '';
    if (closed) btnText = 'Shop closed';
    else if (!user) { btnText = 'Login to Pay'; btnOn = true; }
    else if (qErr) { btnText = 'Unavailable'; note = qErr; }
    else if (!quote || !fresh) btnText = 'Calculating...';
    else if (!quote.canPlace) { btnText = "Can't place"; note = quote.problem || 'Cannot place order'; }
    else btnOn = !placing;

    const onBtn = !user ? () => nav.navigate('Login') : place;
    const shopAddr = full.restaurant?.address;
    const showSchedule = f.scheduleOrder && type === 'delivery';

    return (
        <View style={[s.flex, { backgroundColor: background }]}>
            <BackHeader title={full.restaurant?.name || 'Your Cart'} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                {closed ? <ClosedBanner message={quote?.problem || closedMsg} /> : null}

                {type === 'delivery' && freeAbove > 0 ? <FreeDeliveryBar preview={preview} freeAbove={freeAbove} /> : null}

                <View style={s.pad}>
                    <Appear style={[s.card, { backgroundColor: surface, borderColor: border, marginTop: 12 }]}>
                        {lines.map((l, i) => (
                            <Appear key={l.key} style={[s.lineRow, i === lines.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: border }]}>
                                <View style={s.itemVisuals}>
                                    <View style={[s.itemImgWrap, { backgroundColor: border }]}>
                                        {l.image ? <Image source={{ uri: l.image }} style={s.itemImg} contentFit="cover" transition={200} /> : <Ionicons name="fast-food-outline" size={20} color={muted} style={{ alignSelf: 'center', marginTop: 12 }} />}
                                    </View>
                                    {showDot ? <View style={[s.itemDot, { backgroundColor: surface }]}><VegDot isVeg={l.isVeg} /></View> : null}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.lName, { color: text }]} numberOfLines={2}>{l.name}</Text>
                                    {l.optionsText ? <Text style={[s.lSub, { color: muted }]}>{l.optionsText}</Text> : null}
                                    {l.note ? <Text style={[s.lSub, { color: primary }]}>✎ {l.note}</Text> : null}
                                </View>
                                <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                                    <View style={[s.qs, { borderColor: tint(primary), backgroundColor: tint(primary) }]}>
                                        <Pressable hitSlop={12} onPress={() => setQty(l.key, l.quantity - 1)}><Text style={[s.qBtn, { color: primary }]}>−</Text></Pressable>
                                        <Text style={[s.qNum, { color: primary }]}>{l.quantity}</Text>
                                        <Pressable hitSlop={12} onPress={() => setQty(l.key, l.quantity + 1)}><Text style={[s.qBtn, { color: primary }]}>+</Text></Pressable>
                                    </View>
                                    <Text style={[s.lPrice, { color: text }]}>{rs(linePrice(l, i))}</Text>
                                </View>
                            </Appear>
                        ))}
                        <Pressable onPress={() => nav.goBack()} style={s.addMoreRow}>
                            <Ionicons name="add-circle-outline" size={16} color={primary} />
                            <Text style={[s.addMoreTxt, { color: primary }]}>Add more items</Text>
                        </Pressable>
                    </Appear>

                    {user && type === 'delivery' ? (
                        <Appear delay={60} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>Delivery Instructions</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                {QUICK_NOTES.map((n) => <Chip key={n} label={n} on={delNotes.includes(n)} onPress={() => toggleNote(n)} />)}
                            </ScrollView>
                            <TextInput value={customNote} onChangeText={setCustomNote} placeholder="E.g., Any specific landmark or instructions..."
                                placeholderTextColor={muted} style={[s.customNoteInput, { color: text, borderColor: border, backgroundColor: surface }]} />
                        </Appear>
                    ) : null}

                    {user && couponOn ? (
                        <Appear delay={100} style={{ marginTop: 20 }}>
                            {offers.length > 0 && !applied ? (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                                    {offers.map((o) => (
                                        <Press key={o._id} onPress={() => pickOffer(o.code)} style={[s.couponChip, { borderColor: primary, backgroundColor: tint(primary) }]}>
                                            <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{o.code}</Text>
                                            <Text style={{ color: primary, fontSize: 10, marginTop: 2, opacity: 0.8 }}>
                                                {o.discountType === 'percent' ? `${o.discountValue}% OFF` : `₹${o.discountValue} OFF`}
                                            </Text>
                                        </Press>
                                    ))}
                                </ScrollView>
                            ) : null}
                            {applied ? (
                                <Appear style={[s.applied, { borderColor: primary, backgroundColor: tint(primary) }]}>
                                    <View style={s.cRow}>
                                        <Ionicons name="checkmark-circle" size={20} color={primary} style={{ marginRight: 8 }} />
                                        <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>'{applied}' applied</Text>
                                    </View>
                                    <Pressable hitSlop={8} onPress={() => { ease(); setApplied(''); setCouponErr(''); }}>
                                        <Text style={[s.link, { color: primary }]}>Remove</Text>
                                    </Pressable>
                                </Appear>
                            ) : (
                                <View style={s.cRow}>
                                    <View style={[s.inputWrap, { borderColor: border, backgroundColor: surface }]}>
                                        <Ionicons name="pricetag-outline" size={16} color={muted} style={{ marginRight: 8 }} />
                                        <TextInput value={couponIn} onChangeText={setCouponIn} placeholder="Apply coupon" placeholderTextColor={muted}
                                            autoCapitalize="characters" maxLength={30} style={[s.input, { color: text }]} onSubmitEditing={apply} />
                                    </View>
                                    <Press onPress={apply} style={[s.apply, { backgroundColor: surface, borderColor: border, borderRadius: radius }]}>
                                        {tryCode ? <ActivityIndicator size="small" color={primary} /> : <Text style={[s.link, { color: primary }]}>Apply</Text>}
                                    </Press>
                                </View>
                            )}
                            {couponErr ? <Appear><Text style={[s.err, { color: error }]}>{couponErr}</Text></Appear> : null}
                        </Appear>
                    ) : null}

                    {user && (types.length > 1 || showSchedule) ? (
                        <Appear delay={140} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>Order Settings</Text>
                            {types.length > 1 ? (
                                <View style={s.chipsRow}>
                                    {types.map((t) => <Chip key={t} on={type === t} icon={t === 'delivery' ? 'bicycle-outline' : 'basket-outline'} label={t === 'delivery' ? 'Delivery' : 'Pickup'} onPress={() => setPickedType(t)} />)}
                                </View>
                            ) : null}
                            {showSchedule ? (
                                <View style={s.chipsRow}>
                                    <Chip icon="flash-outline" label="Now" on={when === 'now'} onPress={() => setWhen('now')} />
                                    {slots.today ? <Chip icon="time-outline" label={slots.today.label} on={when === 'today'} onPress={() => setWhen('today')} /> : null}
                                    <Chip icon="calendar-outline" label={slots.tomorrow.label} on={when === 'tomorrow'} onPress={() => setWhen('tomorrow')} />
                                </View>
                            ) : null}
                        </Appear>
                    ) : null}

                    {user && type === 'pickup' ? (
                        <Appear style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text }]}>Pickup time</Text>
                            <Text style={[s.lSub, { color: muted, marginTop: 2, marginBottom: 12 }]}>Choose a time window to collect your order</Text>
                            <PickupSlots res={slotRes} picked={pickedSlot} onPick={(v) => { ease(); setPickedSlot(v); }} />
                        </Appear>
                    ) : null}

                    {user && f.tips && type === 'delivery' && (full.orders.tipOptions || []).length ? (
                        <Appear style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>Tip your delivery partner</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <Chip label="No tip" icon="close" on={tip === 0} onPress={() => setTip(0)} />
                                {full.orders.tipOptions.map((n) => <Chip key={n} icon="heart-outline" label={rs(n)} on={tip === n} onPress={() => setTip(n)} />)}
                            </ScrollView>
                        </Appear>
                    ) : null}

                    {user && type === 'delivery' ? (
                        <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <View style={s.cardHead}>
                                <Ionicons name="location-outline" size={18} color={primary} />
                                <Text style={[s.cap, { color: muted, marginLeft: 6 }]}>Deliver to</Text>
                            </View>
                            {addr ? (
                                <View style={{ marginTop: 8 }}>
                                    <Text style={[s.lName, { color: text }]}>{addr.label}{addr.name ? ` · ${addr.name}` : ''}</Text>
                                    <Text style={[s.lSub, { color: muted }]}>{addrLine(addr)}</Text>
                                </View>
                            ) : <Text style={[s.lSub, { color: muted, marginTop: 8 }]}>No address selected</Text>}
                            <Pressable hitSlop={8} onPress={() => setSheet(true)} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                                <Text style={[s.link, { color: primary }]}>{addr ? 'Change Address' : 'Add Address'}</Text>
                            </Pressable>
                        </Appear>
                    ) : null}
                    {user && type === 'pickup' && shopAddr?.line ? (
                        <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <View style={s.cardHead}>
                                <Ionicons name="storefront-outline" size={18} color={primary} />
                                <Text style={[s.cap, { color: muted, marginLeft: 6 }]}>Pick up from</Text>
                            </View>
                            <Text style={[s.lSub, { color: muted, marginTop: 8 }]}>{[shopAddr.line, shopAddr.city, shopAddr.pincode].filter(Boolean).join(', ')}</Text>
                        </Appear>
                    ) : null}

                    <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                        <View style={s.billHead}>
                            <View style={s.cardHead}>
                                <Ionicons name="receipt-outline" size={18} color={text} />
                                <Text style={[s.lName, { color: text, marginLeft: 8 }]}>Bill details</Text>
                            </View>
                            {busy ? <ActivityIndicator size="small" color={primary} /> : null}
                        </View>
                        {user && quote ? <Bill q={quote} type={type} busy={busy} baseDeliveryFee={feeConfig.amount} />
                            : user && qErr ? (
                                <View style={{ paddingVertical: 10 }}>
                                    <Text style={[s.err, { color: error }]}>{qErr}</Text>
                                    <Pressable hitSlop={8} onPress={() => setTick((x) => x + 1)}><Text style={[s.link, { color: primary, marginTop: 8 }]}>Try again</Text></Pressable>
                                </View>
                            ) : user ? <ActivityIndicator style={{ margin: 16 }} color={primary} />
                                : <Bill q={{ pricing: { subtotal: preview, total: preview } }} type={type} busy={false} />}
                    </Appear>

                    <View style={s.policyBox}>
                        <Text style={[s.policy, { color: muted }]}>Orders cannot be cancelled once preparation begins at the restaurant.</Text>
                    </View>
                </View>
            </ScrollView>

            <View style={[s.dockWrap, { backgroundColor: surface, borderTopColor: border, paddingBottom: insets.bottom || 12 }]}>
                {note ? (
                    <Appear key={note} style={[s.note, { backgroundColor: tint(error) }]}>
                        <Ionicons name="information-circle-outline" size={16} color={error} />
                        <Text style={[s.noteTxt, { color: error }]} numberOfLines={2}>{note}</Text>
                    </Appear>
                ) : null}
                <View style={s.dockRow}>
                    <Pressable onPress={() => nav.navigate('PaymentMethods', { current: paymentMethodValue })} style={s.dockLeft}>
                        <View style={s.dockIcon}><Ionicons name="wallet-outline" size={18} color={primary} /></View>
                        <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={[s.dockLabel, { color: text }]} numberOfLines={1}>{selectedPaymentMethod}</Text>
                                <Ionicons name="chevron-up-outline" size={14} color={muted} style={{ marginLeft: 4 }} />
                            </View>
                            <Text style={[s.dockSub, { color: muted }]} numberOfLines={1}>Click to change</Text>
                        </View>
                    </Pressable>
                    <Press onPress={btnOn ? onBtn : undefined} style={[s.dockBtn, { backgroundColor: btnOn ? primary : muted, borderRadius: radius }]}>
                        {placing ? <ActivityIndicator color="#FFFFFF" /> : (
                            <View style={s.btnRow}>
                                <View>
                                    <Text style={s.btnTotal}>{quote && !closed ? rs(quote.pricing.total) : ' '}</Text>
                                    <Text style={s.btnLabel} numberOfLines={1}>{btnText}</Text>
                                </View>
                                <Ionicons name="caret-forward-outline" size={14} color="#FFFFFF" style={{ marginLeft: 8 }} />
                            </View>
                        )}
                    </Press>
                </View>
            </View>

            <AddressSheet visible={sheet} onClose={() => setSheet(false)} selectedId={addr?._id} onSelect={setAddr}
                onChanged={(L) => setAddr((p) => L.find((a) => a._id === p?._id) || L.find((a) => a.isDefault) || L[0] || null)} />
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 60 },
    iconCircle: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    big: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
    cta: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 14, elevation: 2 },
    ctaTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    tracker: { backgroundColor: '#FEF3F2', paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    trackerTxt: { fontSize: 13, color: '#B3261E', fontWeight: '500' },
    barBg: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 8, overflow: 'hidden' },
    barFill: { height: 4, borderRadius: 2 },
    pad: { paddingHorizontal: 16 },
    card: { marginTop: 24, borderWidth: 1, borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    lineRow: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    itemVisuals: { width: 52, height: 52, marginRight: 12 },
    itemImgWrap: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
    itemImg: { width: '100%', height: '100%' },
    itemDot: { position: 'absolute', bottom: -2, right: -2, borderRadius: 4, padding: 2, zIndex: 1 },
    lName: { fontSize: 14, fontWeight: '800' },
    lSub: { fontSize: 12, marginTop: 4, lineHeight: 16 },
    lPrice: { textAlign: 'right', fontSize: 14, fontWeight: '800', marginTop: 4 },
    addMoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EEEEEE' },
    addMoreTxt: { fontSize: 13, fontWeight: '700', marginLeft: 6 },
    qs: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 4, paddingVertical: 4, borderRadius: 8 },
    qBtn: { fontSize: 16, fontWeight: '800', paddingHorizontal: 8 },
    qNum: { fontSize: 13, fontWeight: '800', minWidth: 20, textAlign: 'center' },
    cRow: { flexDirection: 'row', alignItems: 'center' },
    inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48 },
    input: { flex: 1, fontSize: 14, fontWeight: '700', paddingVertical: 0 },
    apply: { marginLeft: 10, borderWidth: 1, paddingHorizontal: 20, height: 48, justifyContent: 'center', alignItems: 'center', minWidth: 84 },
    applied: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, padding: 14 },
    couponChip: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginRight: 12, minWidth: 100, alignItems: 'center', justifyContent: 'center' },
    link: { fontSize: 13, fontWeight: '800' },
    err: { fontSize: 12, marginTop: 8, paddingHorizontal: 4 },
    customNoteInput: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 12, fontSize: 13, fontWeight: '500' },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    cap: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
    cardHead: { flexDirection: 'row', alignItems: 'center' },
    billHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    policyBox: { marginTop: 16, padding: 12, backgroundColor: '#F8F9FA', borderRadius: 8 },
    policy: { fontSize: 11, lineHeight: 16 },
    dockWrap: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, elevation: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: -4 } },
    dockRow: { flexDirection: 'row', alignItems: 'center' },
    note: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginBottom: 10 },
    noteTxt: { flex: 1, marginLeft: 8, fontSize: 12, fontWeight: '700' },
    dockLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
    dockIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    dockLabel: { fontSize: 14, fontWeight: '800', marginBottom: 2, flexShrink: 1 },
    dockSub: { fontSize: 11, fontWeight: '500' },
    dockBtn: { paddingVertical: 10, paddingHorizontal: 18, minWidth: 140, flexShrink: 0, elevation: 2 },
    btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    btnTotal: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', opacity: 0.9 },
    btnLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});