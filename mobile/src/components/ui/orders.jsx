// src/ui/orders.jsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { themedAlert } from './dialog';
import { useBrand } from './kit';
import { showToast, tint } from './shop';
import { useCartStore } from '../../store/shopStores';
import { cancelOrder, reorderOrder, fetchProduct } from '../../api/shopApi';

export const STATUS_LABEL = {
    placed: 'Placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup',
    out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
};
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
export const isActive = (st) => ACTIVE.includes(st);
export const rs = (n) => `₹${+Number(n || 0).toFixed(2)}`;
export const errMsg = (e) => e?.response?.data?.error
    || (e?.response ? 'Something went wrong. Try again.' : 'Network problem. Check your connection.');
export const itemsText = (o) => (o.items || []).map((l) => `${l.quantity} × ${l.name}`).join(', ');

export function StatusPill({ status }) {
    const { primary } = useBrand();
    const done = status === 'delivered';
    const gone = status === 'cancelled';
    return (
        <View style={[s.pill, { backgroundColor: done ? '#E6F4EA' : gone ? '#EEEEEE' : tint(primary) }]}>
            <Text style={[s.pillTxt, { color: done ? '#1E8E3E' : gone ? '#777777' : primary }]}>
                {STATUS_LABEL[status] || status}
            </Text>
        </View>
    );
}

// Asks first, then cancels. The server decides if cancel is allowed (canCancel).
export function cancelFlow(order, { onDone, setBusy } = {}) {
    themedAlert('Cancel this order?', `Order #${order.orderNo} will be cancelled.`, [
        { text: 'Keep order', style: 'cancel' },
        {
            text: 'Cancel order',
            style: 'destructive',
            onPress: async () => {
                if (setBusy) setBusy(true);
                try {
                    const u = await cancelOrder(order.id);
                    showToast('Order cancelled');
                    if (onDone) onDone(u);
                } catch (e) {
                    showToast(errMsg(e));
                } finally { if (setBusy) setBusy(false); }
            },
        },
    ]);
}

// product + what was ordered -> a cart line (price is only a preview, the quote is the truth)
function toLine(p, it) {
    let price = p.price;
    const names = [];
    (it.selections || []).forEach((sel) => {
        const g = (p.optionGroups || []).find((x) => x.id === sel.groupId);
        (sel.optionIds || []).forEach((oid) => {
            const o = g?.options?.find((x) => x.id === oid);
            if (o) { price += o.price || 0; names.push(o.name); }
        });
    });
    return {
        productId: p._id, name: p.name, image: p.image, isVeg: p.isVeg, price,
        quantity: it.quantity, selections: it.selections || [], optionsText: names.join(', '),
        note: it.note || undefined,
    };
}

// Reorder: ask the server, reload each dish for name/image/price, rebuild the cart, open the cart (it quotes by itself)
export function reorder(order, nav, setBusy) {
    const go = async () => {
        if (setBusy) setBusy(true);
        try {
            const r = await reorderOrder(order.id);
            const skipped = [...(r.skipped || [])];
            const built = (await Promise.all((r.items || []).map(async (it) => {
                try { return toLine(await fetchProduct(it.productId), it); } catch (e) {
                    skipped.push(order.items.find((l) => String(l.productId) === String(it.productId))?.name || 'An item');
                    return null;
                }
            }))).filter(Boolean);
            if (!built.length) { showToast('These items are not available right now'); return; }
            const cart = useCartStore.getState();
            cart.clear();
            built.forEach((l) => cart.add(l));
            if (skipped.length) showToast(`Not available: ${skipped.join(', ')}`);
            nav.navigate('Cart');
        } catch (e) {
            showToast(errMsg(e));
        } finally { if (setBusy) setBusy(false); }
    };
    if (useCartStore.getState().lines.length) {
        themedAlert('Replace your cart?', 'Your current cart items will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', onPress: go },
        ]);
    } else go();
}

const s = StyleSheet.create({
    pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
    pillTxt: { fontSize: 11, fontWeight: '700' },
});