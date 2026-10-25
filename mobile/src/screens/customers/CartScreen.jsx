// src/screens/CartScreen.jsx
import { amountLabel } from '../../utils/customers/measure';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, LayoutAnimation, Switch } from 'react-native';
import { ActivityIndicator } from '../../components/common/Loading';
import { ListShimmer } from '../../components/owners/shimmer';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import { whereAmI, openPhoneSettings } from '../../utils/customers/whereAmI';
import { ask } from '../../components/common/dialog';
import { useBrand, BackHeader, CardGlow } from '../../components/common/kit';
import { VegDot, useClosedStyle, showToast, tint } from '../../components/customers/shop';
import { AddressSheet, addrLine } from '../../components/customers/addresses';
import { Press, Appear, Chip, Bill, ClosedBanner, PickupSlots, FreeDeliveryBar, rs, ease } from '../../components/customers/cartParts';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useCartStore, useFavStore } from '../../store/customers/shopStores';
import { CouponTicket } from '../../components/customers/coupon';
import { FavouriteDishes } from '../../components/customers/favourites';
import { useCouponStore } from '../../store/customers/useCouponStore';
import { useOrderMode } from '../../store/customers/useOrderMode';
import { useTableBill } from '../../store/customers/useTableBill';
import TableSheet from '../../components/customers/TableSheet';
import ChoosePartySheet from '../../components/customers/ChoosePartySheet';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { quoteOrder, placeOrder, fetchPickupSlots } from '../../api/customers/shopApi';
import { payForOrder, prewarmPayments, abandonUnpaidOrder } from '../../utils/customers/payOnline';
import PayShimmer from '../../components/customers/PayShimmer';
import { usePayChoice } from '../../store/customers/usePayChoice';
import DineBusyNote from '../../components/customers/DineBusyNote';
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';
import { tr } from '../../i18n';
import { onMenuChanged } from '../../api/common/socket';
import KeyboardScroll from '../../components/common/KeyboardScroll';

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
    const { primary, onPrimary, radius, text, error, background, surface, border, muted, neutralSoft } = useBrand();

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

    // the way he orders is chosen on the Home screen; the choice here moves it too
    const mode = useOrderMode((st) => st.mode);
    const table = useOrderMode((st) => st.table);
    const dineOn = !!full.orders.dineIn?.enabled;
    const [tableOpen, setTableOpen] = useState(false);
    const [partyOpen, setPartyOpen] = useState(false);   // shared table: he must choose his bill first
    const [pickedType, setPickedType] = useState(types.includes(mode) ? mode : types[0]);
    useEffect(() => { if (types.includes(mode)) setPickedType(mode); }, [mode]);   // eslint-disable-line react-hooks/exhaustive-deps
    const type = dineOn && mode === 'dine_in' ? 'dine_in' : (types.includes(pickedType) ? pickedType : types[0]);

    const [couponIn, setCouponIn] = useState('');
    const [tryCode, setTryCode] = useState('');      // coupon being checked right now
    const [applied, setApplied] = useState('');      // coupon the server accepted
    const [couponErr, setCouponErr] = useState('');
    const [when, setWhen] = useState('now');
    const [tip, setTip] = useState(0);
    const [delNotes, setDelNotes] = useState([]);
    const [customNote, setCustomNote] = useState('');
    const [foodNote, setFoodNote] = useState('');   // for the cook (delivery and pickup); a table order has its own "How should we make it?"
    const [prefs, setPrefs] = useState([]);       // "Make it spicy"... (dine in)
    const [prefNote, setPrefNote] = useState('');  // what he writes himself
    const addr = useAddressStore((st) => st.selected);
    const closedStyle = useClosedStyle();   // the shop is closed: this whole screen turns grey
    const setAddr = useAddressStore((st) => st.setSelected);
    const [sheet, setSheet] = useState(false);
    const [slotRes, setSlotRes] = useState(null);
    const [pickedSlot, setPickedSlot] = useState(null);

    // chosen on the payment screens (they write the store and go back; the card lives in memory for ONE payment)
    const selectedPaymentMethod = usePayChoice((st) => st.label);
    const paymentMethodValue = usePayChoice((st) => st.value);
    const upiApp = usePayChoice((st) => st.upiApp);   // { pkg, label }
    const card = usePayChoice((st) => st.card);       // { number, month, year, cvv, name }
    // an online method is chosen: get the payment SDK ready now, so "Place order" goes straight to the UPI app
    useEffect(() => { if (paymentMethodValue !== 'cod') prewarmPayments(); }, [paymentMethodValue]);

    const [quote, setQuote] = useState(null);
    const [usePts, setUsePts] = useState(false);   // "use my points" in the bill
    const [quoteKey, setQuoteKey] = useState('');    // which request the quote belongs to
    const [qErr, setQErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [tick, setTick] = useState(0);
    const [idemKey, setIdemKey] = useState(() => Crypto.randomUUID());   // a new one after a withdrawn payment, so the next try is a new order
    const reqId = useRef(0);

    const slots = useMemo(() => makeSlots(full.orders.prepTimeMin || 20), []);
    const couponOn = f.couponField && full.offers.couponsEnabled;
    const shownOffers = offers.filter((o) => !o.dineInOnly || type === 'dine_in');
    const preview = lines.reduce((a, l) => a + l.price * l.quantity, 0);
    const priceKey = lines.map((l) => l.price).join(',');
    const pending = useCouponStore((st) => st.code);
    // an empty cart with saved dishes: the message stays put at the top and the dishes scroll below it
    const favCount = useFavStore((st) => st.ids.length);
    const hasFavs = !!user && !!f.favourites && favCount > 0;

    // Only what changes the price goes here, so typing a note never re-quotes.
    const body = useMemo(() => {
        if (!lines.length) return null;
        const b = {
            orderType: type,
            paymentMethod: paymentMethodValue,
            items: lines.map((l) => ({
                productId: l.productId, quantity: l.quantity, selections: l.selections || [], note: l.note || undefined, ...(l.measureQty ? { measureQty: l.measureQty } : {}) })) };
        const code = applied || tryCode;
        if (code && couponOn) b.couponCode = code;
        if (usePts) b.usePoints = true;
        if (type === 'delivery') {
            if (addr) b.addressId = addr._id;
            if (f.tips && tip > 0) b.tip = tip;
            if (f.scheduleOrder && when !== 'now' && slots[when]) b.scheduledFor = slots[when].iso;
        }
        if (type === 'pickup' && pickedSlot) b.pickupSlot = pickedSlot;
        if (type === 'dine_in') b.tableNo = table;
        return b;
    }, [table, lines, type, applied, tryCode, addr, tip, when, couponOn, paymentMethodValue, pickedSlot, usePts]);
    const bodyKey = JSON.stringify(body);
    // cash for a pickup order may be switched off or capped by the shop: say so, and point to the payment choice
    const pcod = full.orders?.pickupCod;
    const codBlocked = type === 'pickup'
        ? (pcod?.enabled === false ? tr('This shop does not take cash for pickup orders. Please pay online.')
            : (pcod?.max > 0 && quote?.pricing?.total > pcod.max ? tr('Cash for a pickup order is allowed up to ₹{max}. Please pay online for this order.', { max: pcod.max }) : null))
        : null;

    // refresh every minute so a shop that just closed is noticed
    useEffect(() => {
        const i = setInterval(() => setTick((x) => x + 1), 60000);
        return () => clearInterval(i);
    }, []);

    // the shop changed something that decides if this order can be placed (cash allowed again, the cash limit, a fee): price it again now
    useEffect(() => onMenuChanged(() => setTick((x) => x + 1)), []);

    // validate the stored selection against the server (handles deleted or edited addresses)
    useEffect(() => {
        if (user && type === 'delivery') useAddressStore.getState().refresh();
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
            if (r.q) { setQuote(r.q); setQErr(''); setQuoteKey(bodyKey); } else { setQuote(null); setQErr(errMsg(r.e)); if (r.e?.response?.data?.code === 'choose_party') setPartyOpen(true); }
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
    const prefList = full.orders.dineIn?.prefs || [];
    const togglePref = (n) => setPrefs((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
    const toggleNote = (n) => { ease(); setDelNotes((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n])); };
    const setQty = (key, q) => { ease(); useCartStore.getState().setQty(key, q); };

    const fresh = !!quote && quoteKey === bodyKey;
    const closed = quote ? quote.shopOpen === false : full.restaurant?.isOpen === false;
    const closedMsg = full.hours?.closedMessage || full.labels?.closedMessage || 'We are closed right now';

    const place = async () => {
        if (type === 'dine_in' && !table) { setTableOpen(true); return; }   // he has not chosen his table yet
        if (placing || !fresh || !quote.canPlace || closed) return;
        if (useAuthStore.getState().user?.role === 'admin') { showToast(tr('Shop owners cannot order from their own number. Log in with a customer number to try an order.')); return; }
        if (paymentMethodValue === 'card' && !card) { nav.navigate('CardDetails', { depth: 1 }); return; }   // card details are asked every time
        setPlacing(true);
        try {
            const notes = [...delNotes];
            if (customNote.trim()) notes.push(customNote.trim());
            if (type === 'dine_in') { notes.push(...prefs); if (prefNote.trim()) notes.push(prefNote.trim()); }
            const t0 = Date.now();
            let at;
            if (type === 'dine_in' && full.orders?.dineIn?.atShopCheck !== false) {
                const w = await whereAmI();
                if (w.problem) {
                    setPlacing(false);
                    const msg = w.problem === 'off' ? tr('Please switch on your phone location, so the shop knows you are at the shop.')
                        : w.problem === 'none' ? tr('We could not find your location yet. Please try again in a moment.')
                            : tr('Location is needed to confirm you are at the shop. Please allow it.');
                    const go = await ask({ title: tr('Location needed'), message: msg, confirmText: w.problem === 'denied' ? tr('Allow') : tr('Open settings'), cancelText: tr('Not now') });
                    if (go) { if (w.problem === 'denied') place(); else openPhoneSettings(); }
                    return;
                }
                at = w.at;
            }
            const order = await placeOrder({ ...(notes.length ? { ...body, note: notes.join(' | ') } : body), ...(foodNote.trim() && type !== 'dine_in' ? { foodNote: foodNote.trim() } : {}), ...(at ? { at } : {}) }, idemKey);
            if (type === 'dine_in') useTableBill.getState().load();   // the new round is on his table bill
            if (__DEV__) console.log(`[pay] place order took ${Date.now() - t0} ms, paymentStart: ${order?.paymentStart ? 'yes' : 'no'}`);
            const tabs = { name: 'MainTabs', state: { routes: [{ name: 'Orders' }] } };
            // the celebration page: Back from it goes to the Orders tab; it offers Track order / Back to menu
            const placed = (paid) => ({
                name: 'OrderPlaced',
                params: {
                    id: order?._id || order?.id, orderNo: order?.orderNo, total: order?.pricing?.total, paid,
                    method: selectedPaymentMethod, type, etaMin: order?.etaMin || full.orders?.prepTimeMin || null,
                },
            });

            // online order: pay right away, straight into the chosen UPI app. Like Zomato / Blinkit, the order only
            // counts once the money is in: the cart is kept until then, and a cancelled or failed payment
            // takes the customer back to the cart with nothing ordered.
            if (order?.payment?.method && order.payment.method !== 'cod' && order.payment.status !== 'paid') {
                const id = order._id || order.id;
                const r = await payForOrder({ order, user, upiApp, card });
                if (card) usePayChoice.getState().clearCard();   // card details never outlive the attempt

                if (r.status === 'cancelled' || r.status === 'failed') {
                    const a = await abandonUnpaidOrder(id);
                    if (!a.paid) {
                        setIdemKey(Crypto.randomUUID());   // the next "Place order" is a fresh order
                        setTick((x) => x + 1);             // price the cart again
                        showToast(r.status === 'cancelled' ? tr('Payment cancelled. Your cart is safe') : r.message || tr('Payment failed. Try again'));
                        return;                            // stay on the cart
                    }
                    r.status = 'paid';                     // the money had arrived after all
                }

                useCartStore.getState().clear();
                if (r.status !== 'paid') showToast(r.message || tr('We are confirming your payment'));
                nav.dispatch(CommonActions.reset(r.status === 'paid'
                    ? { index: 1, routes: [tabs, placed(true)] }
                    : { index: 1, routes: [tabs, { name: 'OrderDetail', params: { id } }] }));   // still confirming: show the order
                return;
            }

            useCartStore.getState().clear();
            nav.dispatch(CommonActions.reset({ index: 1, routes: [tabs, placed(false)] }));
        } catch (e) {
            const m = errMsg(e);
            showToast(m);
            if (/unpaid bill/i.test(m)) useOwedPrompt.getState().show();   // the reminder with the Call button
            if (/coupon/i.test(m)) { ease(); setApplied(''); setCouponErr(m); }
            if (e?.response?.data?.code === 'choose_party') setPartyOpen(true);
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
            <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
                <BackHeader title={tr('Cart')} />
                <Appear style={hasFavs ? [s.center, { flex: 0, paddingTop: 28, paddingBottom: 18 }] : s.center}>
                    <View style={[s.iconCircle, { backgroundColor: surface, borderColor: border }]}>
                        <Ionicons name="cart-outline" size={48} color={muted} />
                    </View>
                    <Text style={[s.big, { color: text }]}>{full.labels.emptyCart}</Text>
                    <Text style={[s.lSub, { color: muted, marginTop: 6 }]}>{tr('Good food is always cooking.')}</Text>
                    <Press onPress={() => nav.goBack()} style={[s.cta, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text numberOfLines={1} style={s.ctaTxt}>{tr('Browse Menu')}</Text>
                    </Press>
                </Appear>
                {hasFavs ? <FavouriteDishes mode="list" /> : null}
            </View>
        );
    }

    const freeAbove = feeConfig.freeAbove || 0;
    const unlocked = freeAbove > 0 && preview >= freeAbove;

    let btnText = type === 'dine_in' && paymentMethodValue === 'cod' ? 'Send to kitchen' : 'Place Order';
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
        <View style={[s.flex, { backgroundColor: background }, closedStyle]}>
            <BackHeader title={full.restaurant?.name || tr('Your Cart')} />
            <KeyboardScroll keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                {closed ? <ClosedBanner message={quote?.problem || closedMsg} /> : null}

                {type === 'delivery' && freeAbove > 0 ? <FreeDeliveryBar preview={preview} freeAbove={freeAbove} /> : null}

                <View style={s.pad}>
                    <Appear style={[s.card, { backgroundColor: surface, borderColor: border, marginTop: 12 }]}>
                        <CardGlow radius={16} />
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
                                    {l.measureQty ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Pressable onPress={() => nav.navigate('Item', { id: l.productId })} hitSlop={8} style={[s.qs, { borderColor: tint(primary), backgroundColor: tint(primary), paddingHorizontal: 10 }]}>
                                                <Text style={[s.qNum, { color: primary }]}>{amountLabel(l.sellBy, l.measureQty)}</Text>
                                            </Pressable>
                                            <Pressable hitSlop={12} onPress={() => setQty(l.key, 0)} style={{ marginLeft: 8 }}>
                                                <Ionicons name="trash-outline" size={18} color={muted} />
                                            </Pressable>
                                        </View>
                                    ) : (
                                        <View style={[s.qs, { borderColor: tint(primary), backgroundColor: tint(primary) }]}>
                                            <Pressable hitSlop={12} onPress={() => setQty(l.key, l.quantity - 1)}><Text style={[s.qBtn, { color: primary }]}>−</Text></Pressable>
                                            <Text style={[s.qNum, { color: primary }]}>{l.quantity}</Text>
                                            <Pressable hitSlop={12} onPress={() => setQty(l.key, l.quantity + 1)}><Text style={[s.qBtn, { color: primary }]}>+</Text></Pressable>
                                        </View>
                                    )}
                                    <Text style={[s.lPrice, { color: text }]}>{rs(linePrice(l, i))}</Text>
                                </View>
                            </Appear>
                        ))}
                        <Pressable onPress={() => nav.goBack()} style={s.addMoreRow}>
                            <Ionicons name="add-circle-outline" size={16} color={primary} />
                            <Text style={[s.addMoreTxt, { color: primary }]}>{tr('Add more items')}</Text>
                        </Pressable>
                    </Appear>

                    <FavouriteDishes mode="strip" />

                    {user && type !== 'dine_in' ? (
                        <Appear delay={50} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('Instructions for the kitchen')}</Text>
                            <TextInput value={foodNote} onChangeText={setFoodNote} maxLength={200} placeholder={tr('E.g., less spicy, no onion, extra crispy...')}
                                placeholderTextColor={muted} style={[s.customNoteInput, { color: text, borderColor: border, backgroundColor: surface, marginTop: 0 }]} />
                            <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The cook hears this before your food is made.')}</Text>
                        </Appear>
                    ) : null}

                    {user && type === 'delivery' ? (
                        <Appear delay={60} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('Delivery Instructions')}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                {QUICK_NOTES.map((n) => <Chip key={n} label={n} on={delNotes.includes(n)} onPress={() => toggleNote(n)} />)}
                            </ScrollView>
                            <TextInput value={customNote} onChangeText={setCustomNote} placeholder={tr('E.g., Any specific landmark or instructions...')}
                                placeholderTextColor={muted} style={[s.customNoteInput, { color: text, borderColor: border, backgroundColor: surface }]} />
                        </Appear>
                    ) : null}

                    {user && type === 'dine_in' ? (
                        <Appear delay={80} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('How should we make it?')}</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                {prefList.map((n) => <Chip key={n} label={tr(n)} on={prefs.includes(n)} onPress={() => togglePref(n)} />)}
                            </View>
                            <TextInput value={prefNote} onChangeText={setPrefNote} maxLength={120} placeholder={tr('Or write it yourself: extra hot, no ice...')}
                                placeholderTextColor={muted} style={[s.customNoteInput, { color: text, borderColor: border, backgroundColor: surface, marginTop: prefList.length ? 4 : 0 }]} />
                            <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The kitchen sees this before your food is made.')}</Text>
                        </Appear>
                    ) : null}

                    {user && couponOn ? (
                        <Appear delay={100} style={{ marginTop: 20 }}>
                            {shownOffers.length > 0 && !applied ? (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                                    {shownOffers.map((o) => (
                                        <CouponTicket key={o._id} o={o} size="mini" onPress={() => pickOffer(o.code)} style={{ marginRight: 10 }} />
                                    ))}
                                </ScrollView>
                            ) : null}
                            {applied ? (
                                <Appear style={[s.applied, { borderColor: primary, backgroundColor: tint(primary) }]}>
                                    <View style={s.cRow}>
                                        <Ionicons name="checkmark-circle" size={20} color={primary} style={{ marginRight: 8 }} />
                                        <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>{tr('\'{applied}\' applied', { applied: applied })}</Text>
                                    </View>
                                    <Pressable hitSlop={8} onPress={() => { ease(); setApplied(''); setCouponErr(''); }}>
                                        <Text style={[s.link, { color: primary }]}>{tr('Remove')}</Text>
                                    </Pressable>
                                </Appear>
                            ) : (
                                <View style={s.cRow}>
                                    <View style={[s.inputWrap, { borderColor: border, backgroundColor: surface }]}>
                                        <Ionicons name="pricetag-outline" size={16} color={muted} style={{ marginRight: 8 }} />
                                        <TextInput value={couponIn} onChangeText={setCouponIn} placeholder={tr('Apply coupon')} placeholderTextColor={muted}
                                            autoCapitalize="characters" maxLength={30} style={[s.input, { color: text }]} onSubmitEditing={apply} />
                                    </View>
                                    <Press onPress={apply} style={[s.apply, { backgroundColor: surface, borderColor: border, borderRadius: radius }]}>
                                        {tryCode ? <ActivityIndicator size="small" color={primary} /> : <Text style={[s.link, { color: primary }]}>{tr('Apply')}</Text>}
                                    </Press>
                                </View>
                            )}
                            {couponErr ? <Appear><Text style={[s.err, { color: error }]}>{couponErr}</Text></Appear> : null}
                        </Appear>
                    ) : null}

                    {user && type === 'dine_in' ? (
                        <Appear delay={140} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('Dining at')}</Text>
                            <Pressable onPress={() => setTableOpen(true)} style={[s.card, { backgroundColor: surface, borderColor: border, flexDirection: 'row', alignItems: 'center', marginHorizontal: 0 }]}>
                                <Ionicons name="restaurant" size={22} color={primary} />
                                <Text style={[s.lName, { color: text, flex: 1, marginLeft: 10 }]}>{table ? tr('Table {n}', { n: table }) : tr('Choose your table')}</Text>
                                <Text style={{ color: primary, fontWeight: '800' }}>{tr('Change')}</Text>
                            </Pressable>
                            <DineBusyNote />
                        </Appear>
                    ) : null}

                    {user && type !== 'dine_in' && (types.length > 1 || showSchedule) ? (
                        <Appear delay={140} style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('Order Settings')}</Text>
                            {types.length > 1 ? (
                                <View style={s.chipsRow}>
                                    {types.map((t) => <Chip key={t} on={type === t} icon={t === 'delivery' ? 'bicycle-outline' : 'basket-outline'} label={t === 'delivery' ? tr('Delivery') : tr('Pickup')} onPress={() => { setPickedType(t); useOrderMode.getState().setMode(t); }} />)}
                                </View>
                            ) : null}
                            {showSchedule ? (
                                <View style={s.chipsRow}>
                                    <Chip icon="flash-outline" label={tr('Now')} on={when === 'now'} onPress={() => setWhen('now')} />
                                    {slots.today ? <Chip icon="time-outline" label={slots.today.label} on={when === 'today'} onPress={() => setWhen('today')} /> : null}
                                    <Chip icon="calendar-outline" label={slots.tomorrow.label} on={when === 'tomorrow'} onPress={() => setWhen('tomorrow')} />
                                </View>
                            ) : null}
                        </Appear>
                    ) : null}

                    {user && type === 'pickup' ? (
                        <Appear style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text }]}>{tr('Pickup time')}</Text>
                            <Text style={[s.lSub, { color: muted, marginTop: 2, marginBottom: 12 }]}>{tr('Choose a time window to collect your order')}</Text>
                            <PickupSlots res={slotRes} picked={pickedSlot} onPick={(v) => { ease(); setPickedSlot(v); }} />
                        </Appear>
                    ) : null}

                    {user && f.tips && type === 'delivery' && (full.orders.tipOptions || []).length ? (
                        <Appear style={{ marginTop: 20 }}>
                            <Text style={[s.cap, { color: text, marginBottom: 8 }]}>{tr('Tip your delivery partner')}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <Chip label={tr('No tip')} icon="close" on={tip === 0} onPress={() => setTip(0)} />
                                {full.orders.tipOptions.map((n) => <Chip key={n} icon="heart-outline" label={rs(n)} on={tip === n} onPress={() => setTip(n)} />)}
                            </ScrollView>
                        </Appear>
                    ) : null}

                    {user && type === 'delivery' ? (
                        <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <CardGlow radius={16} />
                            <View style={s.cardHead}>
                                <Ionicons name="location-outline" size={18} color={primary} />
                                <Text style={[s.cap, { color: muted, marginLeft: 6 }]}>{tr('Deliver to')}</Text>
                            </View>
                            {addr ? (
                                <View style={{ marginTop: 8 }}>
                                    <Text style={[s.lName, { color: text }]}>{addr.label}{addr.name ? ` · ${addr.name}` : ''}{addr.phone ? ` · ${addr.phone}` : ''}</Text>
                                    <Text style={[s.lSub, { color: muted }]}>{addrLine(addr)}</Text>
                                </View>
                            ) : <Text style={[s.lSub, { color: muted, marginTop: 8 }]}>{tr('No address selected')}</Text>}
                            <Pressable hitSlop={8} onPress={() => setSheet(true)} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                                <Text style={[s.link, { color: primary }]}>{addr ? tr('Change Address') : tr('Add Address')}</Text>
                            </Pressable>
                        </Appear>
                    ) : null}
                    {user && type === 'pickup' && shopAddr?.line ? (
                        <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <CardGlow radius={16} />
                            <View style={s.cardHead}>
                                <Ionicons name="storefront-outline" size={18} color={primary} />
                                <Text style={[s.cap, { color: muted, marginLeft: 6 }]}>{tr('Pick up from')}</Text>
                            </View>
                            <Text style={[s.lSub, { color: muted, marginTop: 8 }]}>{[shopAddr.line, shopAddr.city, shopAddr.pincode].filter(Boolean).join(', ')}</Text>
                        </Appear>
                    ) : null}

                    {codBlocked && paymentMethodValue === 'cod' ? (
                        <Pressable onPress={() => nav.navigate('PaymentMethods', { current: paymentMethodValue, currentApp: upiApp?.pkg, codBlocked })} style={[s.card, { backgroundColor: surface, borderColor: error, flexDirection: 'row', alignItems: 'center' }]}>
                            <Ionicons name="cash-outline" size={22} color={error} />
                            <Text style={[s.lSub, { color: text, flex: 1, marginLeft: 10, fontWeight: '700' }]}>{codBlocked}</Text>
                            <Ionicons name="chevron-forward" size={18} color={muted} />
                        </Pressable>
                    ) : null}

                    {user && quote?.points?.enabled && (quote.points.balance > 0 || quote.points.pendingPoints > 0) ? (
                        <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="gift" size={22} color={primary} />
                                <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
                                    <Text style={[s.lName, { color: text }]}>{tr('Use my points')}</Text>
                                    <Text style={[s.lSub, { color: muted, marginTop: 2 }]}>
                                        {quote.points.canUse
                                            ? tr('Use {p} points and save ₹{r}', { p: quote.points.maxPoints, r: quote.points.maxRupees })
                                            : tr('You have {b} points. You can use them from {m} points.', { b: quote.points.balance, m: quote.points.minRedeem })}
                                    </Text>
                                    {quote.points.pendingPoints > 0 ? <Text style={[s.lSub, { color: muted, marginTop: 2 }]}>{tr('{n} more points are on the way', { n: quote.points.pendingPoints })}</Text> : null}
                                </View>
                                <Switch value={usePts && quote.points.canUse} disabled={!quote.points.canUse && !usePts} onValueChange={setUsePts} trackColor={{ true: primary }} />
                            </View>
                        </Appear>
                    ) : null}

                    <Appear style={[s.card, { backgroundColor: surface, borderColor: border }]}>
                            <CardGlow radius={16} />
                        <View style={s.billHead}>
                            <View style={s.cardHead}>
                                <Ionicons name="receipt-outline" size={18} color={text} />
                                <Text style={[s.lName, { color: text, marginLeft: 8 }]}>{tr('Bill details')}</Text>
                            </View>
                            {busy ? <ActivityIndicator size="small" color={primary} /> : null}
                        </View>
                        {user && quote ? <Bill q={quote} type={type} busy={busy} baseDeliveryFee={feeConfig.amount} />
                            : user && qErr ? (
                                <View style={{ paddingVertical: 10 }}>
                                    <Text style={[s.err, { color: error }]}>{qErr}</Text>
                                    <Pressable hitSlop={8} onPress={() => setTick((x) => x + 1)}><Text style={[s.link, { color: primary, marginTop: 8 }]}>{tr('Try again')}</Text></Pressable>
                                </View>
                            ) : user ? <ListShimmer count={2} />
                                : <Bill q={{ pricing: { subtotal: preview, total: preview } }} type={type} busy={false} />}
                    </Appear>

                    <View style={[s.policyBox, { backgroundColor: neutralSoft }]}>
                        <Text style={[s.policy, { color: muted }]}>{tr('Orders cannot be cancelled once preparation begins at the restaurant.')}</Text>
                    </View>
                </View>
            </KeyboardScroll>

            <View style={[s.dockWrap, { backgroundColor: surface, borderTopColor: border, paddingBottom: insets.bottom || 12 }]}>
                {note ? (
                    <Appear key={note} style={[s.note, { backgroundColor: tint(error) }]}>
                        <Ionicons name="information-circle-outline" size={16} color={error} />
                        <Text style={[s.noteTxt, { color: error }]} numberOfLines={3}>{note}</Text>
                    </Appear>
                ) : null}
                {/unpaid bill/i.test(note) ? (
                    <Pressable onPress={() => useOwedPrompt.getState().show()} style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: primary, marginBottom: 10 }}>
                        <Text style={{ color: onPrimary, fontWeight: '900' }}>{tr('View bill and pay')}</Text>
                    </Pressable>
                ) : null}
                <View style={s.dockRow}>
                    <Pressable onPress={() => nav.navigate('PaymentMethods', { current: paymentMethodValue, currentApp: upiApp?.pkg, codBlocked, dineIn: type === 'dine_in' })} style={s.dockLeft}>
                        <View style={s.dockIcon}><Ionicons name="wallet-outline" size={18} color={primary} /></View>
                        <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={[s.dockLabel, { color: text }]} numberOfLines={1}>{/^cash on delivery$/i.test(selectedPaymentMethod) ? (type === 'dine_in' ? tr('Pay at the end') : tr('COD')) : selectedPaymentMethod}</Text>
                                <Ionicons name="chevron-up-outline" size={14} color={muted} style={{ marginLeft: 4 }} />
                            </View>
                            <Text style={[s.dockSub, { color: muted }]} numberOfLines={1}>{tr('Click to change')}</Text>
                        </View>
                    </Pressable>
                    <Press onPress={btnOn ? onBtn : undefined} style={[s.dockBtn, { backgroundColor: btnOn ? primary : muted, borderRadius: radius }]}>
                        {placing ? <ActivityIndicator color="#FFFFFF" /> : (
                            <View style={[s.btnRow, !(quote && !closed) && { justifyContent: 'center' }]}>
                                <View style={!(quote && !closed) ? { alignItems: 'center' } : undefined}>
                                    {quote && !closed ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={s.btnTotal}>{rs(quote.pricing.total)}</Text> : null}
                                    <Text style={s.btnLabel} numberOfLines={1}>{btnText}</Text>
                                </View>
                                <Ionicons name="caret-forward-outline" size={14} color="#FFFFFF" style={{ marginLeft: 8 }} />
                            </View>
                        )}
                    </Press>
                </View>
            </View>

            <AddressSheet
                visible={sheet}
                onClose={() => setSheet(false)}
                selectedId={addr?._id}
                onSelect={setAddr}
                onChanged={(L) => useAddressStore.getState().sync(L)}
            />

            {/* online order: our own screen appears the moment "Place order" is tapped, like Zomato / Blinkit,
                instead of a dead pause before the payment app opens */}
            <TableSheet visible={tableOpen} onClose={() => setTableOpen(false)} />
            <ChoosePartySheet visible={partyOpen} table={table} onClose={() => setPartyOpen(false)} onChosen={() => { setPartyOpen(false); setTick((x) => x + 1); }} />
            {placing && paymentMethodValue !== 'cod' ? <PayShimmer appName={upiApp?.label} /> : null}
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
    dockLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: 12 },
    dockIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    dockLabel: { fontSize: 14, fontWeight: '800', marginBottom: 2, flexShrink: 1 },
    dockSub: { fontSize: 11, fontWeight: '500' },
    dockBtn: { flex: 1, minHeight: 52, paddingVertical: 10, paddingHorizontal: 16, justifyContent: 'center', elevation: 2 },
    btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
    btnTotal: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', opacity: 0.9 },
    btnLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' } });