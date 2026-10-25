// What the owner can do about a problem the cook reported: tell the customer (a polite note), cancel (the money goes back by itself when it was
// paid online), or leave it. The words sent to the customer are written by the server, politely, and shown here before they go.
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { Button, Sheet, Chips } from './ui';
import { resolveKitchenProblem, fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { themedAlert } from '../common/dialog';
import { tr } from '../../i18n';

export const problemWords = (p) => (p?.kind === 'out_of_stock' ? tr('a dish is finished') : p?.kind === 'cannot_make' ? tr('it cannot be made') : (p?.note || tr('there is a problem')));

export default function KitchenProblemActions({ order, onDone, onLater }) {
    const { muted, primary } = useBrand();
    const [busy, setBusy] = useState('');
    const paid = !!order.payment?.method && order.payment.method !== 'cod' && order.payment.status === 'paid';
    const can = ['accepted', 'preparing', 'ready'].includes(order.status);
    const [offerOpen, setOfferOpen] = useState(false);
    const [pct, setPct] = useState(10);          // 0 = no offer
    const [remember, setRemember] = useState(false);
    const go = async (action, offerPercent) => {
        setBusy(action);
        try {
            await resolveKitchenProblem(order.id || order._id, action, undefined, offerPercent);
            showToast(action === 'tell' ? tr('The customer was told') : action === 'cancel' ? tr(paid ? 'Cancelled. The refund is on its way.' : 'Order cancelled') : tr('Done'));
            onDone?.(action);
        } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    // "Tell the customer": first, the question "offer a discount to stay?" (unless the owner said always or never before)
    const tellFirst = async () => {
        setBusy('tell');
        let mode = 'ask'; let percent = 10;
        try { const st = await fetchSettings(); mode = st.orders?.kitchenOfferMode || 'ask'; percent = st.orders?.kitchenOfferPercent || 10; } catch (e) { /* ask */ }
        setBusy('');
        if (mode === 'always') { go('tell', percent); return; }
        if (mode === 'never') { go('tell'); return; }
        setPct(percent); setRemember(false); setOfferOpen(true);
    };
    const sendTell = async () => {
        setOfferOpen(false);
        if (remember) {
            try { await saveSettings({ orders: { kitchenOfferMode: pct ? 'always' : 'never', ...(pct ? { kitchenOfferPercent: pct } : {}) } }); showToast(tr('Remembered. You can change this on the Kitchen staff page.')); } catch (e) { showToast(apiError(e)); }
        }
        go('tell', pct || undefined);
    };
    const confirmCancel = () => themedAlert(tr('Cancel this order?'), paid ? tr('The customer is told sorry, and the full payment is refunded.') : tr('The customer is told sorry.'), [
        { text: tr('Keep it'), style: 'cancel' },
        { text: paid ? tr('Cancel and refund') : tr('Cancel order'), style: 'destructive', onPress: () => go('cancel') },
    ], { icon: 'close-circle-outline' });
    return (
        <View>
            <Button label={tr('Tell the customer')} icon="chatbubble-ellipses-outline" busy={busy === 'tell'} disabled={!!busy} onPress={tellFirst} />
            <Text style={{ color: muted, fontSize: 12, margin: 6, marginBottom: 10 }}>{tr('Sends a polite note: sorry, it may take longer. You can also offer a discount to keep the customer.')}</Text>
            {can ? <Button label={paid ? tr('Cancel and refund') : tr('Cancel order')} icon="close-circle-outline" kind="ghost" busy={busy === 'cancel'} disabled={!!busy} onPress={confirmCancel} style={{ marginBottom: 8 }} /> : null}
            <Button label={onLater ? tr('Later') : tr('I will handle it')} kind="ghost" disabled={!!busy} onPress={() => (onLater ? onLater() : go('dismiss'))} />

            <Sheet visible={offerOpen} onClose={() => setOfferOpen(false)} title={tr('Offer something to keep the customer?')}>
                <Text style={{ color: muted, marginBottom: 6 }}>{tr('If the customer keeps this order and orders more food now (worth at least this order), they get a discount on the new order. They can add the food in one tap.')}</Text>
                <Chips options={[[0, tr('No offer')], [10, '10% off'], [15, '15% off'], [20, '20% off']]} value={pct} onChange={setPct} />
                <Pressable onPress={() => setRemember((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 14 }} accessibilityRole="checkbox">
                    <Ionicons name={remember ? 'checkbox' : 'square-outline'} size={24} color={remember ? primary : muted} />
                    <Text style={{ color: muted, marginLeft: 10, flex: 1 }}>{tr('Remember my choice (do not ask me again)')}</Text>
                </Pressable>
                <Button label={pct ? tr('Tell the customer and offer {n}%', { n: pct }) : tr('Tell the customer')} icon="chatbubble-ellipses-outline" onPress={sendTell} />
            </Sheet>
        </View>
    );
}
