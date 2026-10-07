// src/screens/CartScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useBrand, BackHeader } from '../components/ui/kit';
import { VegDot, showToast, tint } from '../components/ui/shop';
import { AddressSheet, addrLine } from '../components/ui/addresses';
import { useHomeStore } from '../store/useHomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/shopStores';
import { quoteOrder, placeOrder, fetchAddresses } from '../api/shopApi';
import { useCouponStore } from '../store/useCouponStore';

const rs = (n) => `₹${+Number(n || 0).toFixed(2)}`;
const errMsg = (e) => e?.response?.data?.error
    || (e?.response ? 'Something went wrong. Try again.' : 'Network problem. Check your connection.');
const hr = (d) => `${d.getHours() % 12 || 12} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;

// "Today" = next full hour after prep time + 30 min, "Tomorrow" = 1 PM. The server checks shop hours.
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

function Chip({ label, on, onPress }) {
    const { primary, text } = useBrand();
    return (
        <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: tint(primary), borderColor: primary }]}>
            <Text style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
        </Pressable>
    );
}

function Row({ k, v, green, bold }) {
    const { text } = useBrand();
    return (
        <View style={s.bRow}>
            <Text style={[s.bK, bold && s.bold, { color: green ? '#1E8E3E' : text }]}>{k}</Text>
            <Text style={[s.bV, bold && s.bold, { color: green ? '#1E8E3E' : text }]}>{v}</Text>
        </View>
    );
}

function Bill({ q, type, busy }) {
    const p = q.pricing;
    return (
        <View style={{ opacity: busy ? 0.5 : 1 }}>
            <Row k="Subtotal" v={rs(p.subtotal)} />
            {p.discount > 0 ? <Row k={`Coupon${p.couponCode ? ` (${p.couponCode})` : ''}`} v={`− ${rs(p.discount)}`} green /> : null}
            {type === 'delivery' ? <Row k="Delivery fee" v={p.deliveryFee > 0 ? rs(p.deliveryFee) : 'Free'} green={!p.deliveryFee} /> : null}
            {p.packagingCharge > 0 ? <Row k="Packaging" v={rs(p.packagingCharge)} /> : null}
            {p.taxMode === 'exclusive' && p.tax > 0 ? <Row k="GST" v={rs(p.tax)} /> : null}
            {p.tip > 0 ? <Row k="Tip" v={rs(p.tip)} /> : null}
            <View style={s.line} />
            <Row k="Total" v={rs(p.total)} bold />
            {p.taxMode === 'inclusive' && p.tax > 0 ? <Text style={s.incl}>Includes {rs(p.tax)} GST</Text> : null}
        </View>
    );
}

export default function CartScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, radius, text, error } = useBrand();
    const user = useAuthStore((st) => st.user);
    const full = useHomeStore((st) => st.full);
    const showDot = useHomeStore((st) => st.config.showVegDot);
    const lines = useCartStore((st) => st.lines);
    const f = full.features;

    const types = useMemo(() => {
        const t = (full.orders.types || []).filter((x) => x === 'delivery' || x === 'pickup');
        return t.length ? t : ['delivery'];
    }, [full.orders.types]);
    const [pickedType, setPickedType] = useState(types[0]);
    const type = types.includes(pickedType) ? pickedType : types[0];

    const [couponIn, setCouponIn] = useState('');
    const [applied, setApplied] = useState('');
    const [couponErr, setCouponErr] = useState('');
    const [when, setWhen] = useState('now');
    const [tip, setTip] = useState(0);
    const [addr, setAddr] = useState(null);
    const [sheet, setSheet] = useState(false);
    const [quote, setQuote] = useState(null);
    const [qErr, setQErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [tick, setTick] = useState(0);
    const [idemKey] = useState(() => Crypto.randomUUID());
    const reqId = useRef(0);
    const slots = useMemo(() => makeSlots(full.orders.prepTimeMin || 20), []);

    const couponOn = f.couponField && full.offers.couponsEnabled;

    // a code chosen on the Offers page
    const pending = useCouponStore((st) => st.code);
    useEffect(() => {
        if (pending && user && couponOn && lines.length) {
            setCouponErr('');
            setApplied(pending);
            useCouponStore.getState().clear();
        }
    }, [pending, user, couponOn, lines.length]);

    // same body for quote and place order
    const body = useMemo(() => {
        if (!lines.length) return null;
        const b = {
            orderType: type,
            paymentMethod: 'cod',
            items: lines.map((l) => ({
                productId: l.productId, quantity: l.quantity, selections: l.selections || [], note: l.note || undefined,
            })),
        };
        if (applied && couponOn) b.couponCode = applied;
        if (type === 'delivery') {
            if (addr) b.addressId = addr._id;
            if (f.tips && tip > 0) b.tip = tip;
        }
        if (f.scheduleOrder && when !== 'now' && slots[when]) b.scheduledFor = slots[when].iso;
        return b;
    }, [lines, type, applied, addr, tip, when, couponOn]);

    // default address
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

    // server quote, 300 ms after the last change
    const bodyKey = JSON.stringify(body);
    useEffect(() => {
        if (!user || !body) { setQuote(null); setQErr(''); setBusy(false); return undefined; }
        setBusy(true);
        const id = ++reqId.current;
        const t = setTimeout(async () => {
            const run = async (b) => {
                try { return { q: await quoteOrder(b) }; } catch (e) { return { e }; }
            };
            let r = await run(body);
            let cErr = '';
            if (r.e && body.couponCode) {
                // if it works without the coupon, the coupon was the problem
                const r2 = await run({ ...body, couponCode: undefined });
                if (r2.q) { cErr = errMsg(r.e); r = r2; }
            }
            if (id !== reqId.current) return;
            if (cErr) { setCouponErr(cErr); setApplied(''); }
            if (r.q) { setQuote(r.q); setQErr(''); } else { setQuote(null); setQErr(errMsg(r.e)); }
            setBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [bodyKey, user, tick]);

    const apply = () => {
        const c = couponIn.trim().toUpperCase();
        if (!c) return;
        setCouponErr('');
        setApplied(c);
        setCouponIn('');
    };

    const place = async () => {
        if (placing || busy || !quote?.canPlace) return;
        setPlacing(true);
        try {
            await placeOrder(body, idemKey);
            useCartStore.getState().clear();
            showToast('Order placed');
            nav.dispatch(CommonActions.reset({
                index: 0,
                routes: [{ name: 'MainTabs', state: { routes: [{ name: 'Orders' }] } }],
            }));
        } catch (e) {
            showToast(errMsg(e));
            if (e?.response) setTick((x) => x + 1);
        } finally { setPlacing(false); }
    };

    const preview = lines.reduce((a, l) => a + l.price * l.quantity, 0);
    const linePrice = (l, i) => {
        const q = quote?.items?.[i];
        const ok = q && String(q.productId) === String(l.productId) && q.quantity === l.quantity;
        return ok ? q.lineTotal : +(l.price * l.quantity).toFixed(2);
    };

    if (!lines.length) {
        return (
            <View style={s.flex}>
                <BackHeader title="Your cart" />
                <View style={s.center}>
                    <Text style={[s.big, { color: text }]}>{full.labels.emptyCart}</Text>
                    <Pressable onPress={() => nav.goBack()} style={[s.cta, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text style={s.ctaTxt}>Browse the menu</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // bottom button
    let btnText;
    let btnOn = false;
    if (!user) { btnText = 'Log in to continue'; btnOn = true; }
    else if (qErr) btnText = qErr;
    else if (!quote) btnText = 'Please wait…';
    else if (!quote.canPlace) btnText = quote.problem || 'Cannot place this order';
    else { btnText = `${full.labels.orderButton} · ${rs(quote.pricing.total)}`; btnOn = !busy && !placing; }
    const onBtn = !user ? () => nav.navigate('Login') : place;
    const shopAddr = full.restaurant?.address;

    return (
        <View style={s.flex}>
            <BackHeader title="Your cart" />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                <View style={s.pad}>
                    {lines.map((l, i) => (
                        <View key={l.key} style={s.lineRow}>
                            {showDot ? <View style={{ marginTop: 3 }}><VegDot isVeg={l.isVeg} /></View> : null}
                            <View style={{ flex: 1 }}>
                                <Text style={[s.lName, { color: text }]}>{l.name}</Text>
                                {l.optionsText ? <Text style={s.lSub}>{l.optionsText}</Text> : null}
                                {l.note ? <Text style={s.lSub}>Note: {l.note}</Text> : null}
                            </View>
                            <View style={[s.qs, { borderColor: primary, borderRadius: radius }]}>
                                <Pressable hitSlop={8} onPress={() => useCartStore.getState().setQty(l.key, l.quantity - 1)}>
                                    <Text style={[s.qBtn, { color: primary }]}>−</Text>
                                </Pressable>
                                <Text style={[s.qNum, { color: primary }]}>{l.quantity}</Text>
                                <Pressable hitSlop={8} onPress={() => useCartStore.getState().setQty(l.key, l.quantity + 1)}>
                                    <Text style={[s.qBtn, { color: primary }]}>+</Text>
                                </Pressable>
                            </View>
                            <Text style={[s.lPrice, { color: text }]}>{rs(linePrice(l, i))}</Text>
                        </View>
                    ))}

                    {user && couponOn ? (
                        <View style={{ marginTop: 14 }}>
                            {applied ? (
                                <View style={[s.applied, { borderColor: primary, backgroundColor: tint(primary) }]}>
                                    <Text style={{ color: primary, fontWeight: '800' }}>{applied} applied</Text>
                                    <Pressable onPress={() => { setApplied(''); setCouponErr(''); }}>
                                        <Text style={[s.link, { color: primary }]}>Remove</Text>
                                    </Pressable>
                                </View>
                            ) : (
                                <View style={s.cRow}>
                                    <TextInput
                                        value={couponIn} onChangeText={setCouponIn} placeholder="Coupon code"
                                        placeholderTextColor="#999999" autoCapitalize="characters" maxLength={30} style={s.input}
                                    />
                                    <Pressable onPress={apply} style={[s.apply, { borderColor: primary, borderRadius: radius }]}>
                                        <Text style={[s.link, { color: primary }]}>Apply</Text>
                                    </Pressable>
                                </View>
                            )}
                            {couponErr ? <Text style={[s.err, { color: error }]}>{couponErr}</Text> : null}
                        </View>
                    ) : null}

                    {user && types.length > 1 ? (
                        <View style={s.chips}>
                            {types.map((t) => <Chip key={t} on={type === t} label={t === 'delivery' ? 'Delivery' : 'Pickup'} onPress={() => setPickedType(t)} />)}
                        </View>
                    ) : null}

                    {user && f.scheduleOrder ? (
                        <View style={s.chips}>
                            <Chip label="Now" on={when === 'now'} onPress={() => setWhen('now')} />
                            {slots.today ? <Chip label={slots.today.label} on={when === 'today'} onPress={() => setWhen('today')} /> : null}
                            <Chip label={slots.tomorrow.label} on={when === 'tomorrow'} onPress={() => setWhen('tomorrow')} />
                        </View>
                    ) : null}

                    {user && f.tips && type === 'delivery' && (full.orders.tipOptions || []).length ? (
                        <View style={s.chips}>
                            <Text style={s.cap}>Tip</Text>
                            <Chip label="None" on={tip === 0} onPress={() => setTip(0)} />
                            {full.orders.tipOptions.map((n) => <Chip key={n} label={rs(n)} on={tip === n} onPress={() => setTip(n)} />)}
                        </View>
                    ) : null}

                    {user && type === 'delivery' ? (
                        <View style={s.card}>
                            <Text style={s.cap}>Deliver to</Text>
                            {addr ? (
                                <>
                                    <Text style={[s.lName, { color: text }]}>{addr.label}{addr.name ? ` · ${addr.name}` : ''}</Text>
                                    <Text style={s.lSub}>{addrLine(addr)}</Text>
                                </>
                            ) : <Text style={s.lSub}>No address selected</Text>}
                            <Pressable onPress={() => setSheet(true)} style={{ marginTop: 8 }}>
                                <Text style={[s.link, { color: primary }]}>{addr ? 'Change' : 'Add address'}</Text>
                            </Pressable>
                        </View>
                    ) : null}
                    {user && type === 'pickup' && shopAddr?.line ? (
                        <View style={s.card}>
                            <Text style={s.cap}>Pick up from</Text>
                            <Text style={s.lSub}>{[shopAddr.line, shopAddr.city, shopAddr.pincode].filter(Boolean).join(', ')}</Text>
                        </View>
                    ) : null}

                    <View style={s.card}>
                        <View style={s.billHead}>
                            <Text style={[s.lName, { color: text }]}>Bill details</Text>
                            {busy ? <ActivityIndicator size="small" color={primary} /> : null}
                        </View>
                        {user && quote ? <Bill q={quote} type={type} busy={busy} />
                            : user && qErr ? (
                                <View>
                                    <Text style={[s.err, { color: error }]}>{qErr}</Text>
                                    <Pressable onPress={() => setTick((x) => x + 1)}><Text style={[s.link, { color: primary, marginTop: 8 }]}>Try again</Text></Pressable>
                                </View>
                            ) : user ? <ActivityIndicator style={{ margin: 12 }} color={primary} />
                                : <Row k="Subtotal" v={rs(preview)} />}
                        <Text style={s.cod}>💵 Cash on delivery</Text>
                    </View>
                </View>
            </ScrollView>

            <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
                <Pressable
                    onPress={btnOn ? onBtn : undefined}
                    style={[s.place, { backgroundColor: btnOn ? primary : '#BBBBBB', borderRadius: radius }]}
                >
                    {placing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.placeTxt} numberOfLines={2}>{btnText}</Text>}
                </Pressable>
            </View>

            <AddressSheet
                visible={sheet} onClose={() => setSheet(false)} selectedId={addr?._id}
                onSelect={setAddr}
                onChanged={(L) => setAddr((p) => L.find((a) => a._id === p?._id) || L.find((a) => a.isDefault) || L[0] || null)}
            />
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#FFFFFF' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800' },
    cta: { marginTop: 18, paddingHorizontal: 28, paddingVertical: 12 },
    ctaTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    pad: { paddingHorizontal: 16 },
    lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
    lName: { fontSize: 14, fontWeight: '700', marginLeft: 2 },
    lSub: { fontSize: 12, color: '#666666', marginTop: 2, marginLeft: 2 },
    lPrice: { width: 64, textAlign: 'right', fontSize: 14, fontWeight: '700' },
    qs: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 8 },
    qBtn: { fontSize: 18, fontWeight: '800', paddingHorizontal: 3 },
    qNum: { fontSize: 14, fontWeight: '800', minWidth: 20, textAlign: 'center' },
    cRow: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 10, padding: 11, fontSize: 14, color: '#1C1C1C' },
    apply: { marginLeft: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 11 },
    applied: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, padding: 12 },
    link: { fontSize: 13, fontWeight: '700' },
    err: { fontSize: 12, marginTop: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 12 },
    cap: { fontSize: 12, fontWeight: '700', color: '#777777', marginRight: 8, marginBottom: 2 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 18, marginRight: 8, marginBottom: 4 },
    chipTxt: { fontSize: 12, fontWeight: '600' },
    card: { marginTop: 14, borderWidth: 1, borderColor: '#EEEEEE', borderRadius: 14, padding: 14 },
    billHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    bRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    bK: { fontSize: 13 },
    bV: { fontSize: 13 },
    bold: { fontSize: 15, fontWeight: '800' },
    line: { height: StyleSheet.hairlineWidth, backgroundColor: '#CCCCCC', marginVertical: 6 },
    incl: { fontSize: 11, color: '#777777', marginTop: 2 },
    cod: { fontSize: 12, color: '#555555', marginTop: 12 },
    bottom: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5', backgroundColor: '#FFFFFF' },
    place: { paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center' },
    placeTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
});