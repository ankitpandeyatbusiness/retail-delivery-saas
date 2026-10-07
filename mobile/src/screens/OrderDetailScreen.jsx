// src/screens/OrderDetailScreen.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api from '../api/client';
import { useBrand, BackHeader } from '../ui/kit';
import { showToast } from '../ui/shop';
import { StatusPill, isActive, rs, errMsg, cancelFlow, reorder } from '../ui/orders';
import { useHomeStore } from '../store/useHomeStore';
import { fetchOrder, rateOrder, fetchRatings } from '../api/shopApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FLOW_DELIVERY = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
const FLOW_OTHER = ['placed', 'accepted', 'preparing', 'ready', 'delivered'];
const STEP = {
    placed: 'Order placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup',
    out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};
const WHO = { customer: 'you', shop: 'the shop', admin: 'admin', system: 'system' };

const fmt = (v) => {
    const d = new Date(v);
    const h = d.getHours();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const addr = (a) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');

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

function Timeline({ o }) {
    const flow = o.orderType === 'delivery' ? FLOW_DELIVERY : FLOW_OTHER;
    const idx = flow.indexOf(o.status);
    return (
        <View style={{ marginVertical: 12 }}>
            {flow.map((st, k) => {
                const done = k <= idx;
                const h = (o.statusHistory || []).find((x) => x.status === st);
                return (
                    <View key={st} style={s.step}>
                        <View style={s.rail}>
                            <View style={[s.dot, done ? { backgroundColor: '#1E8E3E', borderColor: '#1E8E3E' } : { borderColor: '#BBBBBB' }]} />
                            {k < flow.length - 1 ? <View style={[s.bar, { backgroundColor: k < idx ? '#1E8E3E' : '#DDDDDD' }]} /> : null}
                        </View>
                        <View style={{ flex: 1, paddingBottom: 14, opacity: done ? 1 : 0.4 }}>
                            <Text style={s.stepTxt}>{STEP[st]}</Text>
                            {done && h?.at ? <Text style={s.stepTime}>{fmt(h.at)}</Text> : null}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

export default function OrderDetailScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const { primary, radius, text, error } = useBrand();
    const reorderOn = useHomeStore((st) => st.full.features.reorder);
    const [o, setO] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | gone | error
    const [stars, setStars] = useState(0);
    const [busy, setBusy] = useState(false);
    const [dl, setDl] = useState(false);
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

    // pre-fill the stars of an already rated order
    useEffect(() => {
        if (o?.status !== 'delivered' || ratedLoaded.current) return;
        ratedLoaded.current = true;
        fetchRatings(id).then((r) => {
            const L = r.items || [];
            if (L.length) setStars(Math.round(L.reduce((a, x) => a + x.rating, 0) / L.length));
        }).catch(() => { });
    }, [o?.status]);

    const rate = async (k) => {
        setStars(k);
        const ids = [...new Set(o.items.map((l) => String(l.productId)))];   // the same dish twice would be rejected
        try {
            await rateOrder(o.id, ids.map((productId) => ({ productId, rating: k })));
            showToast('Thanks for rating');
        } catch (e) { showToast(errMsg(e)); }
    };

    const invoice = async () => {
        if (dl) return;
        setDl(true);
        try {
            const res = await api.get(`/orders/${o.id}/invoice`, { responseType: 'arraybuffer' });
            const file = new File(Paths.cache, `invoice-${o.orderNo}.pdf`);
            if (file.exists) file.delete();
            file.create();
            file.write(new Uint8Array(res.data));
            if (!(await Sharing.isAvailableAsync())) { showToast('Sharing is not available on this device'); return; }
            await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice #${o.orderNo}`, UTI: 'com.adobe.pdf' });
        } catch (e) {
            showToast(e?.response?.status === 409 ? 'The invoice is only available after delivery' : 'Could not download the invoice');
        } finally { setDl(false); }
    };

    if (state === 'loading') {
        return <View style={s.flex}><BackHeader title="Order" /><ActivityIndicator style={{ marginTop: 60 }} color={primary} /></View>;
    }
    if (state !== 'ok') {
        return (
            <View style={s.flex}>
                <BackHeader title="Order" />
                <View style={s.center}>
                    <Text style={[s.big, { color: text }]}>{state === 'gone' ? 'Order not found' : 'Could not load this order'}</Text>
                    <Pressable onPress={state === 'gone' ? () => nav.goBack() : get}>
                        <Text style={[s.link, { color: primary }]}>{state === 'gone' ? 'Go back' : 'Try again'}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    const p = o.pricing || {};
    const cancelled = o.status === 'cancelled';
    const delivery = o.orderType === 'delivery';
    return (
        <View style={s.flex}>
            <BackHeader title={`Order #${o.orderNo}`} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.pad}>
                <View style={s.rowBetween}>
                    <StatusPill status={o.status} />
                    <Text style={s.muted}>{delivery ? 'Delivery' : 'Pickup'} · Cash on delivery{o.payment?.status === 'paid' ? ' · Paid' : ''}</Text>
                </View>
                {o.scheduledFor ? <Text style={s.muted}>Scheduled for {fmt(o.scheduledFor)}</Text> : null}
                {isActive(o.status) && o.etaMin ? <Text style={s.muted}>Usually ready in about {o.etaMin} min</Text> : null}

                {cancelled ? (
                    <View style={s.cancelBox}>
                        <Text style={{ color: '#B3261E', fontWeight: '600' }}>
                            Cancelled by {WHO[o.cancelledBy] || 'the shop'}{o.cancelReason ? `: ${o.cancelReason}` : ''}
                        </Text>
                    </View>
                ) : <Timeline o={o} />}

                <Text style={[s.h, { color: text }]}>Items</Text>
                {o.items.map((l, i) => (
                    <View key={`${l.productId}${i}`} style={s.item}>
                        <View style={{ flex: 1 }}>
                            <Text style={[s.itemName, { color: text }]}>{l.quantity} × {l.name}</Text>
                            {l.selections?.length ? <Text style={s.muted}>{l.selections.map((x) => x.name).join(', ')}</Text> : null}
                            {l.note ? <Text style={s.muted}>Note: {l.note}</Text> : null}
                        </View>
                        <Text style={[s.itemName, { color: text }]}>{rs(l.lineTotal)}</Text>
                    </View>
                ))}

                <View style={s.line} />
                <Row k="Subtotal" v={rs(p.subtotal)} />
                {p.discount > 0 ? <Row k={`Coupon${p.couponCode ? ` (${p.couponCode})` : ''}`} v={`− ${rs(p.discount)}`} green /> : null}
                {delivery ? <Row k="Delivery fee" v={p.deliveryFee > 0 ? rs(p.deliveryFee) : 'Free'} green={!p.deliveryFee} /> : null}
                {p.packagingCharge > 0 ? <Row k="Packaging" v={rs(p.packagingCharge)} /> : null}
                {p.taxMode === 'exclusive' && p.tax > 0 ? <Row k="GST" v={rs(p.tax)} /> : null}
                {p.tip > 0 ? <Row k="Tip" v={rs(p.tip)} /> : null}
                <Row k="Total" v={rs(p.total)} bold />
                {p.taxMode === 'inclusive' && p.tax > 0 ? <Text style={s.muted}>Includes {rs(p.tax)} GST</Text> : null}

                {delivery && o.address ? (
                    <>
                        <Text style={[s.h, { color: text }]}>Delivery address</Text>
                        <Text style={s.muted}>{[o.address.label, o.address.name].filter(Boolean).join(' · ')}</Text>
                        <Text style={s.muted}>{addr(o.address)}</Text>
                    </>
                ) : null}
                {o.note ? <><Text style={[s.h, { color: text }]}>Order note</Text><Text style={s.muted}>{o.note}</Text></> : null}

                {o.status === 'delivered' ? (
                    <>
                        <Text style={[s.h, { color: text }]}>{stars ? 'Your rating' : 'Rate this order'}</Text>
                        <View style={{ flexDirection: 'row' }}>
                            {[1, 2, 3, 4, 5].map((k) => (
                                <Pressable key={k} onPress={() => rate(k)} hitSlop={4}>
                                    <Text style={s.star}>{stars >= k ? '⭐' : '☆'}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable onPress={invoice} disabled={dl} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                            {dl ? <ActivityIndicator color={primary} /> : <Text style={[s.ghostTxt, { color: primary }]}>Download invoice (PDF)</Text>}
                        </Pressable>
                    </>
                ) : null}

                {o.canCancel ? (
                    <Pressable
                        disabled={busy} onPress={() => cancelFlow(o, { setBusy, onDone: setO })}
                        style={[s.ghost, { borderColor: error, borderRadius: radius }]}
                    >
                        <Text style={[s.ghostTxt, { color: error }]}>Cancel order</Text>
                    </Pressable>
                ) : null}
                {reorderOn ? (
                    <Pressable
                        disabled={busy} onPress={() => reorder(o, nav, setBusy)}
                        style={[s.main, { backgroundColor: primary, borderRadius: radius }]}
                    >
                        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.mainTxt}>Reorder</Text>}
                    </Pressable>
                ) : null}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#FFFFFF' },
    pad: { padding: 16, paddingBottom: 40 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    big: { fontSize: 18, fontWeight: '800' },
    link: { marginTop: 12, fontSize: 14, fontWeight: '700' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    muted: { fontSize: 12, color: '#777777', marginTop: 2 },
    h: { fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 6 },
    cancelBox: { backgroundColor: '#FDECEA', borderRadius: 12, padding: 14, marginVertical: 14 },
    step: { flexDirection: 'row' },
    rail: { width: 24, alignItems: 'center' },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, backgroundColor: '#FFFFFF' },
    bar: { flex: 1, width: 2, marginTop: 2 },
    stepTxt: { fontSize: 14, fontWeight: '600', color: '#1C1C1C' },
    stepTime: { fontSize: 11, color: '#777777', marginTop: 1 },
    item: { flexDirection: 'row', paddingVertical: 6 },
    itemName: { fontSize: 14, fontWeight: '600' },
    line: { height: StyleSheet.hairlineWidth, backgroundColor: '#CCCCCC', marginVertical: 10 },
    bRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    bK: { fontSize: 13 },
    bold: { fontSize: 15, fontWeight: '800' },
    star: { fontSize: 30, marginRight: 6 },
    ghost: { marginTop: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
    ghostTxt: { fontSize: 14, fontWeight: '800' },
    main: { marginTop: 14, paddingVertical: 14, alignItems: 'center' },
    mainTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});