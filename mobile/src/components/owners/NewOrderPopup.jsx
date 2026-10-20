// A new order slides up over whatever screen the owner is on (while the app is open): the order number, the items, the
// total, how it is paid, and the time left to accept. Accept it right there, or open it. Orders queue: the next one shows
// after this one is dealt with. The bell / voice (soundbox.js) keeps going until the order is accepted or opened.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { Button, Pill, money } from './ui';
import { Countdown, PayBadge } from './orderBits';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useOrdersStore } from '../../store/owners/useOrdersStore';
import { onNotification, onOrderUpdate } from '../../api/common/socket';
import { fetchOrder, setOrderStatus, apiError } from '../../api/owners/shopApi';
import { acknowledge } from '../../utils/owners/soundbox';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';
import { DragDown, Grip } from '../common/DragDown';

const TYPE = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };

export default function NewOrderPopup({ navRef }) {
    const { surface, text, muted, border, primary, warn, error } = useBrand();
    const insets = useSafeAreaInsets();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const [queue, setQueue] = useState([]);
    const [busy, setBusy] = useState(false);
    const seen = useRef(new Set());   // orders already shown once: a repeat message does not pop them up again
    const on = role === 'admin' && !customerView && access !== 'blocked';

    const drop = useCallback((id) => setQueue((q) => q.filter((o) => String(o.id) !== String(id))), []);

    useEffect(() => {
        if (!on) { setQueue([]); return undefined; }
        const offNew = onNotification((n) => {
            const id = n?.type === 'order_new' ? String(n?.data?.orderId || '') : '';
            if (!id || seen.current.has(id)) return;
            seen.current.add(id);
            fetchOrder(id)
                .then((o) => {
                    // a table order the shop accepted by itself (auto accept) still shows, so the kitchen sees the table and what he asked for
                    const info = !!o && o.status !== 'placed' && o.orderType === 'dine_in' && !!n?.data?.autoAccepted && ['accepted', 'preparing'].includes(o.status);
                    if (o && (o.status === 'placed' || info)) setQueue((q) => (q.some((x) => String(x.id) === id) ? q : [...q, info ? { ...o, info: true } : o]));
                })
                .catch(() => { });
        });
        // accepted by someone else, cancelled by the customer, timed out: nothing left to decide
        const offUpd = onOrderUpdate((p) => { if (p?.status && p.status !== 'placed') setQueue((q) => q.filter((o) => String(o.id) !== String(p.orderId) || (o.info && p.status !== 'cancelled'))); });
        return () => { offNew(); offUpd(); };
    }, [on, drop]);

    const order = queue[0];
    if (!on || !order) return null;

    // already looking at this very order: no popup needed
    const route = navRef?.isReady?.() ? navRef.getCurrentRoute?.() : null;
    if (route?.name === 'OwnerOrder' && String(route.params?.id) === String(order.id)) { setTimeout(() => drop(order.id), 0); return null; }

    const items = order.items || [];
    const open = () => {
        const id = String(order.id);
        drop(id);
        if (navRef?.isReady?.()) navRef.navigate('OwnerOrder', { id });
    };
    const accept = async () => {
        setBusy(true);
        try {
            const updated = await setOrderStatus(order.id, { status: 'accepted' });
            acknowledge(order.id);
            useOrdersStore.getState().patch(updated);
            useOwnerStore.getState().refresh();
            showToast(tr('Order #{orderNo} accepted', { orderNo: order.orderNo }));
            drop(order.id);
        } catch (e) {
            showToast(apiError(e));
            if (e?.response?.status === 409 || e?.response?.status === 404) drop(order.id);
        } finally { setBusy(false); }
    };

    return (
        <Modal visible transparent animationType="slide" onRequestClose={() => drop(order.id)} statusBarTranslucent>
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
                <DragDown onClose={() => drop(order.id)}>{(scroll) => (
                <View style={[s.sheet, { backgroundColor: surface, borderColor: border, paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
                    <Grip style={{ paddingBottom: 12 }}><View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: border }} /></Grip>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(warn || primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="flash" size={22} color={warn || primary} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: text, fontSize: 20, fontWeight: '900' }}>{tr('New order #{orderNo}', { orderNo: order.orderNo })}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{[TYPE[order.orderType], order.orderType === 'dine_in' && order.tableNo ? `Table ${order.tableNo}` : null, order.customer?.name, order.info ? 'Auto accepted' : null].filter(Boolean).join(' · ')}</Text>
                        </View>
                        <Pressable onPress={() => drop(order.id)} hitSlop={12}><Ionicons name="close" size={24} color={muted} /></Pressable>
                    </View>

                    <ScrollView {...scroll} style={{ maxHeight: 220, marginTop: 14 }} showsVerticalScrollIndicator={false}>
                        {items.map((it, i) => (
                            <View key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                <Text style={{ color: primary, fontWeight: '900', width: 34 }}>{it.quantity}×</Text>
                                <Text style={{ color: text, flex: 1, fontWeight: '600' }}>{it.name}</Text>
                            </View>
                        ))}
                    </ScrollView>
                    {order.note ? <View style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: alpha(warn, 0.16) }}><Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{order.note}</Text></View> : null}

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }}>
                        <Text style={{ color: text, fontSize: 24, fontWeight: '900', flex: 1 }}>{money(order.pricing?.total)}</Text>
                        <PayBadge order={order} />
                    </View>
                    {order.acceptBy && !order.info ? <View style={{ marginTop: 8 }}><Countdown until={order.acceptBy} /></View> : null}
                    {queue.length > 1 ? <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Pill label={tr('{v1} more order{v2} waiting', { v1: queue.length - 1, v2: queue.length === 2 ? '' : 's' })} color={error} /></View> : null}

                    <View style={{ flexDirection: 'row', marginTop: 16 }}>
                        <Button label={tr('View')} kind="ghost" icon="open-outline" onPress={open} disabled={busy} style={{ flex: 1 }} />
                        {order.info
                            ? <Button label={tr('Got it')} icon="checkmark" onPress={() => { acknowledge(order.id); drop(order.id); }} style={{ flex: 1, marginLeft: 8 }} />
                            : <Button label={tr('Accept')} icon="checkmark" busy={busy} onPress={accept} style={{ flex: 1, marginLeft: 8 }} />}
                    </View>
                </View>
                )}</DragDown>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, padding: 18, elevation: 24 },
});
